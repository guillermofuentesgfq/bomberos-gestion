/**
 * Rutas de informes y exportación (Fase G).
 *
 * Cada informe se lee de D1 (ver `services/reports.ts`), se convierte a un
 * `.xlsx` con `services/xlsx.ts` y se devuelve como descarga. Todas las
 * exportaciones exigen el permiso `inventory.export` y quedan auditadas.
 *
 * El router no se monta aquí: otro módulo lo registra en `/reports`.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../lib/env';
import { ok } from '../lib/http';
import { first } from '../lib/db';
import { nowIso } from '../lib/time';
import { requireAuth, requirePermission } from '../security/middleware';
import { actorFrom, type AppContext } from '../security/actor';
import { logAudit } from '../security/audit';
import { buildWorkbook, XLSX_CONTENT_TYPE } from '../services/xlsx';
import type { ReportTable, DateRangeFilter } from '../services/reports';
import {
  assignedReport,
  inventoryPrintReport,
  inventoryReport,
  lowStockReport,
  maintenanceReport,
  movementsReport,
  personnelReport,
  writeoffsReport,
} from '../services/reports';
import { actaInstitution } from '../services/actas';

type AppEnv = { Bindings: Env; Variables: Variables };

export const reportsRoutes = new Hono<AppEnv>();

/** Descripción de una exportación: nombre interno, hoja y archivo. */
interface ExportSpec {
  /** Identificador del informe para la auditoría. */
  report: string;
  /** Nombre de la hoja dentro del libro. */
  sheet: string;
  /** Base del nombre de archivo (sin fecha ni extensión). */
  fileBase: string;
}

/**
 * Convierte un informe a `.xlsx`, lo devuelve como descarga y lo audita.
 *
 * Se usan cabeceras del contexto (`c.header`) y `c.body` para no descartar las
 * cabeceras preparadas por la cadena de middleware.
 */
async function exportXlsx(
  c: AppContext,
  spec: ExportSpec,
  table: ReportTable,
): Promise<Response> {
  const header = table.columns.map((column) => column.header);
  const body = table.rows.map((row) => table.columns.map((column) => row[column.key] ?? null));
  const bytes = buildWorkbook([{ name: spec.sheet, rows: [header, ...body] }]);

  const actor = actorFrom(c);
  await logAudit(c.env.DB, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'report.exported',
    entityType: 'report',
    entityId: spec.report,
    detail: { report: spec.report, format: 'xlsx', rows: table.rows.length },
    ipHash: actor.ipHash,
  });

  const filename = `${spec.fileBase}-${nowIso().slice(0, 10)}.xlsx`;
  c.header('content-type', XLSX_CONTENT_TYPE);
  c.header('content-disposition', `attachment; filename="${filename}"`);
  c.header('content-length', String(bytes.byteLength));
  return c.body(bytes, 200);
}

// --- Exportaciones ----------------------------------------------------------

reportsRoutes.get(
  '/inventory.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await inventoryReport(c.env.DB);
    return exportXlsx(c, { report: 'inventory', sheet: 'Inventario', fileBase: 'inventario' }, table);
  },
);

reportsRoutes.get(
  '/assigned.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await assignedReport(c.env.DB);
    return exportXlsx(c, { report: 'assigned', sheet: 'Asignado', fileBase: 'asignado' }, table);
  },
);

reportsRoutes.get(
  '/movements.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const from = c.req.query('from')?.trim();
    const to = c.req.query('to')?.trim();
    const filter: DateRangeFilter = {};
    if (from) filter.from = from;
    if (to) filter.to = to;
    const table = await movementsReport(c.env.DB, filter);
    return exportXlsx(c, { report: 'movements', sheet: 'Movimientos', fileBase: 'movimientos' }, table);
  },
);

reportsRoutes.get(
  '/writeoffs.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await writeoffsReport(c.env.DB);
    return exportXlsx(c, { report: 'writeoffs', sheet: 'Bajas', fileBase: 'bajas' }, table);
  },
);

reportsRoutes.get(
  '/maintenance.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await maintenanceReport(c.env.DB);
    return exportXlsx(c, { report: 'maintenance', sheet: 'Mantenimiento', fileBase: 'mantenimiento' }, table);
  },
);

reportsRoutes.get(
  '/personnel.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await personnelReport(c.env.DB);
    return exportXlsx(c, { report: 'personnel', sheet: 'Personal', fileBase: 'personal' }, table);
  },
);

reportsRoutes.get(
  '/low-stock.xlsx',
  requireAuth,
  requirePermission('inventory.export'),
  async (c) => {
    const table = await lowStockReport(c.env.DB);
    return exportXlsx(c, { report: 'low-stock', sheet: 'Bajo mínimo', fileBase: 'bajo-minimo' }, table);
  },
);

// --- Inventario imprimible --------------------------------------------------

/**
 * Datos del inventario completo para la vista imprimible. No genera archivo,
 * así que solo exige `inventory.read`, igual que el panel de resumen.
 */
reportsRoutes.get('/inventory', requireAuth, requirePermission('inventory.read'), async (c) => {
  const report = await inventoryPrintReport(c.env.DB);
  return ok(c, {
    institution: await actaInstitution(c.env.DB),
    generatedAt: nowIso(),
    totals: report.totals,
    detail: report.detail,
  });
});

// --- Panel de resumen -------------------------------------------------------

/**
 * Contadores del panel. Solo lectura: se exige `inventory.read` (no el permiso
 * de exportación) porque no genera ningún archivo.
 */
reportsRoutes.get('/summary', requireAuth, requirePermission('inventory.read'), async (c) => {
  const db = c.env.DB;
  const [materials, units, activePersonnel, assignedUnits, writeoffs, lowStock] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM materials WHERE archived_at IS NULL`),
    first<{ n: number }>(db, `SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_levels`),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM persons WHERE archived_at IS NULL AND is_active = 1`,
    ),
    first<{ n: number }>(
      db,
      `SELECT COALESCE(SUM(al.quantity - al.returned_qty), 0) AS n
         FROM assignment_lines al
        WHERE al.returned_qty < al.quantity`,
    ),
    first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM writeoffs`),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM (
         SELECT m.id
           FROM materials m
           LEFT JOIN stock_levels s ON s.material_id = m.id
          WHERE m.archived_at IS NULL
          GROUP BY m.id
         HAVING COALESCE(SUM(s.quantity), 0) < m.min_stock
       )`,
    ),
  ]);

  return ok(c, {
    materials: materials?.n ?? 0,
    units: units?.n ?? 0,
    activePersonnel: activePersonnel?.n ?? 0,
    assignedUnits: assignedUnits?.n ?? 0,
    writeoffs: writeoffs?.n ?? 0,
    lowStock: lowStock?.n ?? 0,
  });
});
