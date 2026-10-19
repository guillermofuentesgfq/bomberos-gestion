/**
 * Rutas de importación masiva.
 *
 * Flujo: se crea un lote, se envían las filas ya normalizadas por lotes
 * pequeños, se consulta el análisis y, al confirmar, se escribe. Todo exige el
 * permiso del dominio (`inventory.import` para materiales, `persons.import`
 * para personas) y queda auditado.
 *
 * Las plantillas se generan al vuelo: no hay archivos binarios en el repo.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { all } from '../lib/db';
import { readJson } from '../lib/validate';
import { nowIso } from '../lib/time';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import type { PermissionCode } from '../security/permissions';
import { buildWorkbook, XLSX_CONTENT_TYPE } from '../services/xlsx';
import {
  createBatch,
  finalizeBatch,
  findBatch,
  ingestMaterialRows,
  ingestPersonRows,
  issueBuckets,
  issueReport,
  listBatches,
  MAX_ROWS_PER_FILE,
  MAX_ROWS_PER_CHUNK,
  type ImportKind,
} from '../services/imports';
import {
  materialTemplate,
  personTemplate,
  templateCsv,
  type TemplateCatalogs,
} from '../services/importTemplates';

type AppEnv = { Bindings: Env; Variables: Variables };

export const importRoutes = new Hono<AppEnv>();

/** Permiso que exige cada tipo de importación. */
const KIND_PERMISSION: Record<ImportKind, PermissionCode> = {
  material: 'inventory.import',
  person: 'persons.import',
};

function authorizer(kind: ImportKind) {
  return requirePermission(KIND_PERMISSION[kind]);
}

function parseId(raw: string | undefined): number {
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success) throw AppError.badRequest('Lote inválido.');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

async function templateCatalogs(db: D1Database): Promise<TemplateCatalogs> {
  const [categories, types, locations, conditions, qualities] = await Promise.all([
    all<{ name: string }>(db, `SELECT name FROM categories WHERE archived_at IS NULL ORDER BY name`),
    all<{ name: string }>(db, `SELECT name FROM material_types WHERE archived_at IS NULL ORDER BY name`),
    all<{ name: string }>(
      db,
      `SELECT name FROM locations WHERE archived_at IS NULL AND is_archive = 0 ORDER BY name`,
    ),
    all<{ name: string }>(db, `SELECT name FROM material_conditions ORDER BY sort_order`),
    all<{ name: string }>(db, `SELECT name FROM qualities WHERE archived_at IS NULL ORDER BY sort_order`),
  ]);
  return {
    categories: categories.map((row) => row.name),
    materialTypes: types.map((row) => row.name),
    locations: locations.map((row) => row.name),
    conditions: conditions.map((row) => row.name),
    qualities: qualities.map((row) => row.name),
  };
}

function templateFilename(kind: ImportKind, extension: string): string {
  return `plantilla-${kind === 'material' ? 'materiales' : 'personas'}-${nowIso().slice(0, 10)}.${extension}`;
}

for (const kind of ['material', 'person'] as const) {
  importRoutes.get(`/templates/${kind}.xlsx`, requireAuth, authorizer(kind), async (c) => {
    const catalogs = await templateCatalogs(c.env.DB);
    const sheets = kind === 'material' ? materialTemplate(catalogs) : personTemplate(catalogs);
    const bytes = buildWorkbook(sheets);
    c.header('content-type', XLSX_CONTENT_TYPE);
    c.header('content-disposition', `attachment; filename="${templateFilename(kind, 'xlsx')}"`);
    c.header('content-length', String(bytes.byteLength));
    return c.body(bytes, 200);
  });

  importRoutes.get(`/templates/${kind}.csv`, requireAuth, authorizer(kind), async (c) => {
    const csv = templateCsv(kind);
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', `attachment; filename="${templateFilename(kind, 'csv')}"`);
    return c.body(csv, 200);
  });
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

importRoutes.get('/', requireAuth, async (c) => {
  const batches = await listBatches(c.env.DB, 20);
  return ok(c, { batches });
});

importRoutes.post('/', requireAuth, requireCsrf, async (c) => {
  const body = await readJson(
    c,
    z.object({
      kind: z.enum(['material', 'person']),
      filename: z.string().trim().max(255).nullable().optional(),
    }),
  );
  const kind = body.kind as ImportKind;
  const user = c.get('user');
  if (user && !user.permissions.includes(KIND_PERMISSION[kind])) {
    throw AppError.forbidden('No tienes permiso para importar este tipo de datos.');
  }
  const id = await createBatch(c.env.DB, kind, body.filename ?? null, user?.id ?? null);
  return ok(c, { id, kind, maxRows: MAX_ROWS_PER_FILE, maxChunk: MAX_ROWS_PER_CHUNK }, 201);
});

/** Comprueba que el lote existe, es del tipo indicado y pertenece a quien lo usa. */
async function requireOwnBatch(c: Context<AppEnv>, id: number, kind?: ImportKind) {
  const batch = await findBatch(c.env.DB, id);
  if (!batch) throw AppError.notFound('Lote de importación no encontrado.');
  if (kind && batch.kind !== kind) {
    throw AppError.unprocessable('El lote no corresponde a este tipo de importación.');
  }
  const user = c.get('user');
  if (!user || !user.permissions.includes(KIND_PERMISSION[batch.kind as ImportKind])) {
    throw AppError.forbidden('No tienes permiso para operar sobre este lote.');
  }
  if (batch.created_by !== null && batch.created_by !== user.id) {
    throw AppError.forbidden('Este lote lo inició otra cuenta.');
  }
  return batch;
}

const looseCell = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]).optional();

const materialRowSchema = z.object({
  rowNo: z.number().int().min(1).max(MAX_ROWS_PER_FILE),
  code: looseCell,
  name: looseCell,
  category: looseCell,
  materialType: looseCell,
  brand: looseCell,
  model: looseCell,
  notes: looseCell,
  minStock: looseCell,
  isIndividual: looseCell,
  location: looseCell,
  condition: looseCell,
  quantity: looseCell,
});

const personRowSchema = z.object({
  rowNo: z.number().int().min(1).max(MAX_ROWS_PER_FILE),
  fullName: looseCell,
  rut: looseCell,
  quality: looseCell,
  position: looseCell,
  phone: looseCell,
  email: looseCell,
  address: looseCell,
  birthDate: looseCell,
  joinDate: looseCell,
  registryNo: looseCell,
  emergencyName: looseCell,
  emergencyPhone: looseCell,
  history: looseCell,
  isActive: looseCell,
});

importRoutes.post('/:id/rows', requireAuth, requireCsrf, async (c) => {
  const id = parseId(c.req.param('id'));
  const batch = await requireOwnBatch(c, id);
  if (batch.status !== 'analyzing') {
    throw AppError.conflict('Este lote ya fue confirmado o está en proceso.');
  }

  if (batch.kind === 'material') {
    const body = await readJson(
      c,
      z.object({ rows: z.array(materialRowSchema).min(1).max(MAX_ROWS_PER_CHUNK) }),
    );
    const result = await ingestMaterialRows(c.env.DB, id, body.rows);
    return ok(c, result);
  }

  const body = await readJson(
    c,
    z.object({ rows: z.array(personRowSchema).min(1).max(MAX_ROWS_PER_CHUNK) }),
  );
  const result = await ingestPersonRows(c.env.DB, id, body.rows);
  return ok(c, result);
});

importRoutes.get('/:id', requireAuth, async (c) => {
  const id = parseId(c.req.param('id'));
  const batch = await requireOwnBatch(c, id);
  const buckets = await issueBuckets(c.env.DB, id);
  return ok(c, {
    batch: {
      id: batch.id,
      kind: batch.kind,
      filename: batch.filename,
      status: batch.status,
      total: batch.total_rows,
      valid: batch.valid_rows,
      errors: batch.error_rows,
      warnings: batch.warning_rows,
      mode: batch.mode,
      result: batch.result === null ? null : (JSON.parse(batch.result) as unknown),
      createdAt: batch.created_at,
      finishedAt: batch.finished_at,
    },
    issues: buckets,
  });
});

importRoutes.post('/:id/finalize', requireAuth, requireCsrf, async (c) => {
  const id = parseId(c.req.param('id'));
  await requireOwnBatch(c, id);
  const body = await readJson(
    c,
    z.object({ mode: z.enum(['all_or_nothing', 'valid_only']) }),
  );
  const result = await finalizeBatch(c.env.DB, id, body.mode, actorFrom(c));
  return ok(c, result);
});

importRoutes.get('/:id/report.xlsx', requireAuth, async (c) => {
  const id = parseId(c.req.param('id'));
  await requireOwnBatch(c, id);
  const issues = await issueReport(c.env.DB, id);
  const rows: (string | number | null)[][] = [
    ['fila', 'columna', 'severidad', 'codigo', 'mensaje', 'valor'],
    ...issues.map((issue) => [
      issue.rowNo,
      issue.column,
      issue.severity,
      issue.code,
      issue.message,
      issue.value,
    ]),
  ];
  const bytes = buildWorkbook([{ name: 'Errores', rows }]);
  c.header('content-type', XLSX_CONTENT_TYPE);
  c.header('content-disposition', `attachment; filename="informe-importacion-${id}.xlsx"`);
  c.header('content-length', String(bytes.byteLength));
  return c.body(bytes, 200);
});
