import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { isUniqueViolation } from '../lib/sql';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import { CONDITION_CODES, type ConditionCode } from '../../shared/inventory';
import * as catalog from '../repositories/catalog';
import * as materials from '../repositories/materials';
import { listMovements, listMovementsForMaterial } from '../repositories/movements';
import {
  addStock,
  addUnit,
  changeCondition,
  createMaterial,
  transferStock,
  updateMaterial,
  writeOff,
} from '../services/inventory';
import { actaInstitution } from '../services/actas';
import { requireScopedObject } from '../services/storage';
import {
  inFlightError,
  reserveIdempotency,
  saveIdempotencyResponse,
} from '../services/idempotency';

type AppEnv = { Bindings: Env; Variables: Variables };

export const inventoryRoutes = new Hono<AppEnv>();

const conditionSchema = z.enum(CONDITION_CODES);

const idParam = z.coerce.number().int().positive();

function parseId(raw: string | undefined, label = 'identificador'): number {
  const parsed = idParam.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest(`${label} inválido.`);
  return parsed.data;
}

// --- Catálogos --------------------------------------------------------------

inventoryRoutes.get('/catalog', requireAuth, requirePermission('inventory.read'), async (c) => {
  const db = c.env.DB;
  const [locations, categories, materialTypes, conditions] = await Promise.all([
    catalog.listLocations(db),
    catalog.listCategories(db),
    catalog.listMaterialTypes(db),
    catalog.listConditions(db),
  ]);
  return ok(c, { locations, categories, materialTypes, conditions });
});

inventoryRoutes.post('/catalog/locations', requireAuth, requireCsrf, requirePermission('institution.write'), async (c) => {
  const body = await readJson(
    c,
    z.object({
      name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
      description: z.string().trim().max(400).nullable().optional(),
    }),
  );
  try {
    const id = await catalog.insertLocation(c.env.DB, body.name, body.description ?? null);
    return ok(c, { id }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) throw AppError.conflict('Esa ubicación ya existe.');
    throw error;
  }
});

inventoryRoutes.post('/catalog/categories', requireAuth, requireCsrf, requirePermission('institution.write'), async (c) => {
  const body = await readJson(
    c,
    z.object({ name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80) }),
  );
  try {
    const id = await catalog.insertCategory(c.env.DB, body.name);
    return ok(c, { id }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) throw AppError.conflict('Esa categoría ya existe.');
    throw error;
  }
});

inventoryRoutes.post(
  '/catalog/material-types',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const body = await readJson(
      c,
      z.object({
        name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
        categoryId: z.number().int().positive().nullable().optional(),
      }),
    );
    try {
      const id = await catalog.insertMaterialType(c.env.DB, body.name, body.categoryId ?? null);
      return ok(c, { id }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('Ese tipo ya existe en esa categoría.');
      }
      throw error;
    }
  },
);

// El catálogo se archiva, no se borra: las existencias y los materiales que lo
// referencian conservan su historia.
inventoryRoutes.delete(
  '/catalog/locations/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'ubicación');
    await catalog.archiveCatalogEntry(c.env.DB, 'locations', id);
    return ok(c, { archived: true });
  },
);

inventoryRoutes.delete(
  '/catalog/categories/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'categoría');
    await catalog.archiveCatalogEntry(c.env.DB, 'categories', id);
    return ok(c, { archived: true });
  },
);

inventoryRoutes.delete(
  '/catalog/material-types/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'tipo de material');
    await catalog.archiveCatalogEntry(c.env.DB, 'material_types', id);
    return ok(c, { archived: true });
  },
);

// Edición del catálogo. Se puede renombrar y corregir; dar de baja una entrada
// sigue siendo el archivado, para no perder el historial que la referencia.
const catalogName = z.string().trim().min(1, 'El nombre es obligatorio.').max(80);

inventoryRoutes.put(
  '/catalog/locations/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'ubicación');
    const body = await readJson(
      c,
      z.object({
        name: catalogName,
        description: z.string().trim().max(400).nullable().optional(),
      }),
    );
    try {
      const changes = await catalog.updateLocation(
        c.env.DB,
        id,
        body.name,
        body.description ?? null,
      );
      if (changes === 0) throw AppError.notFound('Ubicación no encontrada.');
      return ok(c, { updated: true });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('Ya existe una ubicación con ese nombre.');
      throw error;
    }
  },
);

inventoryRoutes.put(
  '/catalog/categories/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'categoría');
    const body = await readJson(c, z.object({ name: catalogName }));
    try {
      const changes = await catalog.updateCategory(c.env.DB, id, body.name);
      if (changes === 0) throw AppError.notFound('Categoría no encontrada.');
      return ok(c, { updated: true });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('Ya existe una categoría con ese nombre.');
      throw error;
    }
  },
);

inventoryRoutes.put(
  '/catalog/material-types/:id',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'tipo de material');
    const body = await readJson(
      c,
      z.object({
        name: catalogName,
        categoryId: z.number().int().positive().nullable().optional(),
      }),
    );
    try {
      const changes = await catalog.updateMaterialType(
        c.env.DB,
        id,
        body.name,
        body.categoryId ?? null,
      );
      if (changes === 0) throw AppError.notFound('Tipo de material no encontrado.');
      return ok(c, { updated: true });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('Ese tipo ya existe en esa categoría.');
      }
      throw error;
    }
  },
);

// --- Materiales -------------------------------------------------------------

const materialFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
});

inventoryRoutes.get('/materials', requireAuth, requirePermission('inventory.read'), async (c) => {
  const parsed = materialFilterSchema.safeParse(c.req.query());
  if (!parsed.success) throw AppError.badRequest('Filtros inválidos.');
  const db = c.env.DB;
  const list = await materials.listMaterials(db, {
    ...(parsed.data.q ? { search: parsed.data.q } : {}),
    ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId } : {}),
    ...(parsed.data.locationId !== undefined ? { locationId: parsed.data.locationId } : {}),
  });
  const summary = await materials.stockSummary(db);
  const byId = new Map(summary.map((s) => [s.material_id, s]));
  return ok(
    c,
    list.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      categoryId: m.category_id,
      materialTypeId: m.material_type_id,
      brand: m.brand,
      model: m.model,
      notes: m.notes,
      minStock: m.min_stock,
      isIndividual: m.is_individual === 1,
      photoObjectId: m.photo_object_id,
      total: byId.get(m.id)?.total ?? 0,
      available: byId.get(m.id)?.available ?? 0,
      belowMinStock: (byId.get(m.id)?.total ?? 0) < m.min_stock,
    })),
  );
});

const createMaterialSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(160),
  code: z.string().trim().max(60).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  materialTypeId: z.number().int().positive().nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  minStock: z.number().int().min(0).max(1_000_000).optional(),
  isIndividual: z.boolean().optional(),
  photoObjectId: z.number().int().positive().nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  conditionCode: conditionSchema.optional(),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
});

inventoryRoutes.post('/materials', requireAuth, requireCsrf, requirePermission('inventory.write'), async (c) => {
  const body = await readJson(c, createMaterialSchema);
  // La foto referida debe ser un objeto de ámbito «inventario».
  if (body.photoObjectId !== undefined && body.photoObjectId !== null) {
    await requireScopedObject(c.env.DB, body.photoObjectId, 'inventory');
  }
  const created = await createMaterial({ DB: c.env.DB }, body, actorFrom(c));
  return ok(c, created, 201);
});

const updateMaterialSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(160).optional(),
  code: z.string().trim().max(60).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  materialTypeId: z.number().int().positive().nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  minStock: z.number().int().min(0).max(1_000_000).optional(),
  isIndividual: z.boolean().optional(),
  photoObjectId: z.number().int().positive().nullable().optional(),
});

inventoryRoutes.put(
  '/materials/:id',
  requireAuth,
  requireCsrf,
  requirePermission('inventory.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'material');
    const body = await readJson(c, updateMaterialSchema);
    if (body.photoObjectId !== undefined && body.photoObjectId !== null) {
      await requireScopedObject(c.env.DB, body.photoObjectId, 'inventory');
    }
    const updated = await updateMaterial({ DB: c.env.DB }, id, body, actorFrom(c));
    const totals = (await materials.stockSummary(c.env.DB)).find((row) => row.material_id === id);
    return ok(c, {
      material: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        categoryId: updated.category_id,
        materialTypeId: updated.material_type_id,
        brand: updated.brand,
        model: updated.model,
        notes: updated.notes,
        minStock: updated.min_stock,
        isIndividual: updated.is_individual === 1,
        photoObjectId: updated.photo_object_id,
        total: totals?.total ?? 0,
        available: totals?.available ?? 0,
        belowMinStock: (totals?.total ?? 0) < updated.min_stock,
      },
    });
  },
);

inventoryRoutes.get('/materials/:id', requireAuth, requirePermission('inventory.read'), async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.env.DB;
  const material = await materials.findMaterialById(db, id);
  if (!material) throw AppError.notFound('Material no encontrado.');
  const [stock, units, movements] = await Promise.all([
    materials.listStock(db, id),
    materials.listUnits(db, id),
    listMovementsForMaterial(db, id, 50),
  ]);
  return ok(c, { material, stock, units, movements });
});

inventoryRoutes.post('/materials/:id/stock', requireAuth, requireCsrf, requirePermission('inventory.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'material');
  const body = await readJson(
    c,
    z.object({
      locationId: z.number().int().positive(),
      conditionCode: conditionSchema,
      quantity: z.number().int().min(1).max(1_000_000),
      notes: z.string().trim().max(2000).nullable().optional(),
    }),
  );
  await addStock(
    { DB: c.env.DB },
    {
      materialId: id,
      locationId: body.locationId,
      conditionCode: body.conditionCode satisfies ConditionCode,
      quantity: body.quantity,
      notes: body.notes ?? null,
    },
    actorFrom(c),
  );
  return ok(c, { added: true }, 201);
});

inventoryRoutes.post('/materials/:id/units', requireAuth, requireCsrf, requirePermission('inventory.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'material');
  const body = await readJson(
    c,
    z.object({
      size: z.string().trim().max(40).nullable().optional(),
      serial: z.string().trim().max(120).nullable().optional(),
      identify: z.boolean().default(false),
    }),
  );
  const created = await addUnit(
    { DB: c.env.DB },
    {
      materialId: id,
      size: body.size ?? null,
      serial: body.serial ?? null,
      identify: body.identify,
    },
    actorFrom(c),
  );
  return ok(c, created, 201);
});

inventoryRoutes.post('/materials/:id/condition', requireAuth, requireCsrf, requirePermission('inventory.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'material');
  const body = await readJson(
    c,
    z.object({
      locationId: z.number().int().positive(),
      fromCondition: conditionSchema,
      toCondition: conditionSchema,
      quantity: z.number().int().min(1).max(1_000_000),
      notes: z.string().trim().max(2000).nullable().optional(),
    }),
  );
  await changeCondition(
    { DB: c.env.DB },
    {
      materialId: id,
      locationId: body.locationId,
      fromCondition: body.fromCondition,
      toCondition: body.toCondition,
      quantity: body.quantity,
      notes: body.notes ?? null,
    },
    actorFrom(c),
  );
  return ok(c, { changed: true });
});

// --- Traslados --------------------------------------------------------------

const transferSchema = z.object({
  materialId: z.number().int().positive(),
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  conditionCode: conditionSchema,
  quantity: z.number().int().min(1).max(1_000_000),
  responsible: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

inventoryRoutes.post('/transfers', requireAuth, requireCsrf, requirePermission('inventory.transfer'), async (c) => {
  const body = await readJson(c, transferSchema);
  const idempotencyKey = c.req.header('idempotency-key');

  if (idempotencyKey) {
    const reservation = await reserveIdempotency(c.env.DB, {
      key: idempotencyKey,
      scope: 'transfer',
      userId: c.get('user')?.id ?? null,
    });
    if (reservation.status === 'replay') return ok(c, JSON.parse(reservation.response));
    if (reservation.status === 'in_flight') throw inFlightError();
  }

  const result = await transferStock(
    { DB: c.env.DB },
    {
      materialId: body.materialId,
      fromLocationId: body.fromLocationId,
      toLocationId: body.toLocationId,
      conditionCode: body.conditionCode,
      quantity: body.quantity,
      responsible: body.responsible ?? null,
      notes: body.notes ?? null,
    },
    actorFrom(c),
  );

  if (idempotencyKey) {
    await saveIdempotencyResponse(c.env.DB, idempotencyKey, 'transfer', result);
  }
  return ok(c, result, 201);
});

// --- Bajas ------------------------------------------------------------------

const writeOffSchema = z.object({
  materialId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  conditionCode: conditionSchema,
  quantity: z.number().int().min(1).max(1_000_000),
  reason: z.string().trim().min(5, 'Indica el motivo de la baja.').max(2000),
  authorizedBy: z.string().trim().min(1, 'Indica quién autoriza.').max(160),
});

inventoryRoutes.post('/writeoffs', requireAuth, requireCsrf, requirePermission('inventory.writeoff'), async (c) => {
  const body = await readJson(c, writeOffSchema);
  const idempotencyKey = c.req.header('idempotency-key');

  if (idempotencyKey) {
    const reservation = await reserveIdempotency(c.env.DB, {
      key: idempotencyKey,
      scope: 'writeoff',
      userId: c.get('user')?.id ?? null,
    });
    if (reservation.status === 'replay') return ok(c, JSON.parse(reservation.response));
    if (reservation.status === 'in_flight') throw inFlightError();
  }

  const result = await writeOff(
    { DB: c.env.DB },
    {
      materialId: body.materialId,
      locationId: body.locationId,
      conditionCode: body.conditionCode,
      quantity: body.quantity,
      reason: body.reason,
      authorizedBy: body.authorizedBy,
    },
    actorFrom(c),
  );

  if (idempotencyKey) {
    await saveIdempotencyResponse(c.env.DB, idempotencyKey, 'writeoff', result);
  }
  return ok(c, result, 201);
});

// --- Acta de baja -----------------------------------------------------------

/**
 * Acta de una baja. Cada baja es una línea (material, cantidad, motivo y quién
 * autoriza), así que el acta lleva un único elemento. Imprimible: el PDF lo
 * produce el navegador.
 */
inventoryRoutes.get(
  '/writeoffs/:id/acta',
  requireAuth,
  requirePermission('inventory.read'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'baja');
    const db = c.env.DB;
    const writeoff = await materials.findWriteOffById(db, id);
    if (!writeoff) throw AppError.notFound('Acta no encontrada.');

    return ok(c, {
      institution: await actaInstitution(db),
      acta: {
        kind: 'baja',
        id: writeoff.id,
        createdAt: writeoff.created_at,
        reason: writeoff.reason,
        authorizedBy: writeoff.authorized_by,
        locationName: writeoff.location_name,
        lines: [
          {
            code: writeoff.code,
            itemName: writeoff.item_name,
            size: writeoff.size,
            quantity: writeoff.quantity,
            priorCondition: writeoff.prior_condition,
            priorConditionName: writeoff.prior_condition_name,
          },
        ],
      },
    });
  },
);

// --- Movimientos ------------------------------------------------------------

inventoryRoutes.get('/movements', requireAuth, requirePermission('inventory.read'), async (c) => {
  const limit = Number(c.req.query('limit') ?? '200');
  const rows = await listMovements(c.env.DB, Number.isFinite(limit) ? limit : 200);
  return ok(c, rows);
});
