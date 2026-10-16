import { batch, run, stmt } from '../lib/db';
import { nowIso } from '../lib/time';
import { AppError } from '../lib/errors';
import { isCheckViolation, isUniqueViolation } from '../lib/sql';
import { slugify } from '../lib/ids';
import { logAudit } from '../security/audit';
import { movementStatement } from '../repositories/movements';
import * as materials from '../repositories/materials';
import * as catalog from '../repositories/catalog';
import { AVAILABLE_CONDITION, type ConditionCode } from '../../shared/inventory';
import type { Actor } from '../security/actor';

// ---------------------------------------------------------------------------
// Sentencias de existencias
//
// La integridad se garantiza con tres piezas que actúan juntas:
//   1. `INSERT OR IGNORE` crea la fila de existencias si no existe (cantidad 0).
//   2. El `UPDATE` resta sin condiciones: si dejaría la cantidad en negativo,
//      la restricción `CHECK (quantity >= 0)` lo rechaza.
//   3. Todo va dentro de `batch()`, que es transaccional: si una sentencia
//      falla, se revierte el conjunto.
// D1 no ofrece transacciones interactivas, así que esta es la forma de lograr
// una garantía atómica de "no hay existencias negativas".
// ---------------------------------------------------------------------------

export function ensureStockStatement(
  db: D1Database,
  materialId: number,
  locationId: number,
  conditionCode: string,
): D1PreparedStatement {
  return stmt(
    db,
    `INSERT OR IGNORE INTO stock_levels (material_id, location_id, condition_code, quantity, updated_at)
     VALUES (?, ?, ?, 0, ?)`,
    materialId,
    locationId,
    conditionCode,
    nowIso(),
  );
}

/**
 * Resta existencias. Falla (y revierte el batch) si quedarían negativas.
 *
 * El `CHECK (quantity >= 0)` solo se evalúa sobre la fila que el `UPDATE` toca:
 * si la fila origen no existe, un `UPDATE` incondicional afectaría 0 filas sin
 * error y el lote confirmaría una operación que no descontó nada (existencias
 * «acuñadas de la nada» en el destino). Por eso **toda** operación que reste
 * existencias asegura antes la fila origen con `ensureStockStatement`.
 */
export function decrementStockStatement(
  db: D1Database,
  materialId: number,
  locationId: number,
  conditionCode: string,
  quantity: number,
): D1PreparedStatement {
  return stmt(
    db,
    `UPDATE stock_levels SET quantity = quantity - ?, updated_at = ?
      WHERE material_id = ? AND location_id = ? AND condition_code = ?`,
    quantity,
    nowIso(),
    materialId,
    locationId,
    conditionCode,
  );
}

export function incrementStockStatement(
  db: D1Database,
  materialId: number,
  locationId: number,
  conditionCode: string,
  quantity: number,
): D1PreparedStatement {
  return stmt(
    db,
    `UPDATE stock_levels SET quantity = quantity + ?, updated_at = ?
      WHERE material_id = ? AND location_id = ? AND condition_code = ?`,
    quantity,
    nowIso(),
    materialId,
    locationId,
    conditionCode,
  );
}

/** Traduce una violación de CHECK de existencias a un error de negocio. */
function stockError(error: unknown, context: string): never {
  if (isCheckViolation(error)) {
    throw AppError.unprocessable(`No hay existencias suficientes para ${context}.`);
  }
  if (isUniqueViolation(error)) {
    throw AppError.conflict('Ya existe un registro con ese código o número de serie.');
  }
  throw error;
}

async function requireLocation(db: D1Database, locationId: number): Promise<catalog.LocationRow> {
  const location = await catalog.findLocation(db, locationId);
  if (!location || location.archived_at !== null) {
    throw AppError.unprocessable('La ubicación indicada no existe.');
  }
  return location;
}

async function requireCondition(db: D1Database, code: ConditionCode): Promise<void> {
  if (!(await catalog.conditionExists(db, code))) {
    throw AppError.unprocessable('La condición indicada no existe.');
  }
}

async function requireMaterial(db: D1Database, materialId: number): Promise<materials.MaterialRow> {
  const material = await materials.findMaterialById(db, materialId);
  if (!material) throw AppError.notFound('Material no encontrado.');
  return material;
}

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------

export interface CreateMaterialInput {
  name: string;
  code?: string | undefined;
  categoryId?: number | null | undefined;
  materialTypeId?: number | null | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
  minStock?: number | undefined;
  isIndividual?: boolean | undefined;
  /** Foto del material (objeto privado en R2). */
  photoObjectId?: number | null | undefined;
  /** Ingreso inicial (opcional). */
  locationId?: number | null | undefined;
  conditionCode?: ConditionCode | undefined;
  quantity?: number | undefined;
}

export interface CreatedMaterial {
  id: number;
  code: string;
}

/** Genera un código único a partir del nombre. */
export async function generateMaterialCode(db: D1Database, name: string): Promise<string> {
  const base = (slugify(name).toUpperCase().replace(/-/g, '').slice(0, 8) || 'MAT').padEnd(3, 'X');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const candidate = `${base}-${suffix}`;
    if (!(await materials.findMaterialByCode(db, candidate))) return candidate;
  }
  throw AppError.internal('No se pudo generar un código único.');
}

export async function createMaterial(
  env: { DB: D1Database },
  input: CreateMaterialInput,
  actor: Actor,
): Promise<CreatedMaterial> {
  const db = env.DB;
  const code = input.code?.trim() || (await generateMaterialCode(db, input.name));

  if (await materials.findMaterialByCode(db, code)) {
    throw AppError.conflict('Ya existe un material con ese código.');
  }

  const quantity = input.quantity ?? 0;
  const hasInitialStock = quantity > 0 && input.locationId !== undefined && input.locationId !== null;

  if (hasInitialStock) {
    await requireLocation(db, input.locationId as number);
    await requireCondition(db, input.conditionCode ?? AVAILABLE_CONDITION);
  }

  let materialId: number;
  try {
    materialId = await materials.insertMaterial(db, {
      code,
      name: input.name,
      categoryId: input.categoryId ?? null,
      materialTypeId: input.materialTypeId ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      notes: input.notes ?? null,
      minStock: input.minStock ?? 0,
      isIndividual: input.isIndividual ?? false,
      photoObjectId: input.photoObjectId ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw AppError.conflict('Ya existe un material con ese código.');
    stockError(error, 'crear el material');
  }

  if (hasInitialStock) {
    const locationId = input.locationId as number;
    const condition = input.conditionCode ?? AVAILABLE_CONDITION;
    await batch(db, [
      ensureStockStatement(db, materialId, locationId, condition),
      incrementStockStatement(db, materialId, locationId, condition, quantity),
      movementStatement(db, {
        type: 'ingreso',
        materialId,
        code,
        itemName: input.name,
        quantity,
        toLocationId: locationId,
        actorUserId: actor.userId,
      }),
    ]);
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.material_created',
    entityType: 'material',
    entityId: materialId,
    detail: { code, initialQuantity: quantity },
    ipHash: actor.ipHash,
  });

  return { id: materialId, code };
}

export interface UpdateMaterialInput {
  name?: string | undefined;
  code?: string | null | undefined;
  categoryId?: number | null | undefined;
  materialTypeId?: number | null | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
  minStock?: number | undefined;
  isIndividual?: boolean | undefined;
  photoObjectId?: number | null | undefined;
}

/**
 * Actualiza un material existente.
 *
 * Solo toca los campos presentes en la entrada, así que el formulario puede
 * enviar un subconjunto sin borrar el resto. `code` vacío conserva el actual, y
 * `photoObjectId: null` quita la foto.
 */
export async function updateMaterial(
  env: { DB: D1Database },
  materialId: number,
  input: UpdateMaterialInput,
  actor: Actor,
): Promise<materials.MaterialRow> {
  const db = env.DB;
  const existing = await requireMaterial(db, materialId);

  const update: materials.MaterialUpdate = {
    name: input.name,
    categoryId: input.categoryId,
    materialTypeId: input.materialTypeId,
    brand: input.brand,
    model: input.model,
    notes: input.notes,
    minStock: input.minStock,
    isIndividual: input.isIndividual,
    photoObjectId: input.photoObjectId,
  };

  if (input.code !== undefined) {
    const candidate = (input.code ?? '').trim() || existing.code;
    if (candidate !== existing.code && (await materials.findMaterialByCode(db, candidate))) {
      throw AppError.conflict('Ya existe un material con ese código.');
    }
    update.code = candidate;
  }

  try {
    await materials.updateMaterial(db, materialId, update);
  } catch (error) {
    if (isUniqueViolation(error)) throw AppError.conflict('Ya existe un material con ese código.');
    throw error;
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.material_updated',
    entityType: 'material',
    entityId: materialId,
    detail: {
      fields: Object.keys(update).filter(
        (key) => update[key as keyof materials.MaterialUpdate] !== undefined,
      ),
    },
    ipHash: actor.ipHash,
  });

  const updated = await materials.findMaterialById(db, materialId);
  if (!updated) throw AppError.internal('No se pudo releer el material actualizado.');
  return updated;
}

// ---------------------------------------------------------------------------
// Ingreso de existencias
// ---------------------------------------------------------------------------

export interface AddStockInput {
  materialId: number;
  locationId: number;
  conditionCode: ConditionCode;
  quantity: number;
  notes?: string | null;
}

export async function addStock(
  env: { DB: D1Database },
  input: AddStockInput,
  actor: Actor,
): Promise<void> {
  const db = env.DB;
  const material = await requireMaterial(db, input.materialId);
  await requireLocation(db, input.locationId);
  await requireCondition(db, input.conditionCode);

  await batch(db, [
    ensureStockStatement(db, input.materialId, input.locationId, input.conditionCode),
    incrementStockStatement(db, input.materialId, input.locationId, input.conditionCode, input.quantity),
    movementStatement(db, {
      type: 'ingreso',
      materialId: material.id,
      code: material.code,
      itemName: material.name,
      quantity: input.quantity,
      toLocationId: input.locationId,
      notes: input.notes ?? null,
      actorUserId: actor.userId,
    }),
  ]);

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.stock_added',
    entityType: 'material',
    entityId: material.id,
    detail: { quantity: input.quantity, locationId: input.locationId, condition: input.conditionCode },
    ipHash: actor.ipHash,
  });
}

// ---------------------------------------------------------------------------
// Traslados
// ---------------------------------------------------------------------------

export interface TransferInput {
  materialId: number;
  fromLocationId: number;
  toLocationId: number;
  conditionCode: ConditionCode;
  quantity: number;
  responsible?: string | null;
  notes?: string | null;
}

export async function transferStock(
  env: { DB: D1Database },
  input: TransferInput,
  actor: Actor,
): Promise<{ transferId: number }> {
  const db = env.DB;
  if (input.fromLocationId === input.toLocationId) {
    throw AppError.unprocessable('El origen y el destino deben ser distintos.');
  }
  const material = await requireMaterial(db, input.materialId);
  await requireLocation(db, input.fromLocationId);
  await requireLocation(db, input.toLocationId);
  await requireCondition(db, input.conditionCode);

  let transferId = 0;
  try {
    const results = await batch(db, [
      // Se asegura la fila **origen** antes de descontar: sin ella el UPDATE no
      // afectaría ninguna fila y el CHECK nunca se evaluaría.
      ensureStockStatement(db, material.id, input.fromLocationId, input.conditionCode),
      ensureStockStatement(db, material.id, input.toLocationId, input.conditionCode),
      decrementStockStatement(db, material.id, input.fromLocationId, input.conditionCode, input.quantity),
      incrementStockStatement(db, material.id, input.toLocationId, input.conditionCode, input.quantity),
      stmt(
        db,
        `INSERT INTO transfers
           (material_id, from_location_id, to_location_id, quantity, responsible, notes, moved_at, actor_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        material.id,
        input.fromLocationId,
        input.toLocationId,
        input.quantity,
        input.responsible ?? null,
        input.notes ?? null,
        nowIso(),
        actor.userId,
      ),
      movementStatement(db, {
        type: 'traslado',
        materialId: material.id,
        code: material.code,
        itemName: material.name,
        quantity: input.quantity,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        responsible: input.responsible ?? null,
        notes: input.notes ?? null,
        actorUserId: actor.userId,
      }),
    ]);
    const insertResult = results[4];
    transferId = Number(insertResult?.meta.last_row_id ?? 0);
  } catch (error) {
    stockError(error, 'el traslado');
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.transferred',
    entityType: 'material',
    entityId: material.id,
    detail: {
      quantity: input.quantity,
      from: input.fromLocationId,
      to: input.toLocationId,
      transferId,
    },
    ipHash: actor.ipHash,
  });

  return { transferId };
}

// ---------------------------------------------------------------------------
// Cambio de condición
// ---------------------------------------------------------------------------

export interface ChangeConditionInput {
  materialId: number;
  locationId: number;
  fromCondition: ConditionCode;
  toCondition: ConditionCode;
  quantity: number;
  notes?: string | null;
}

export async function changeCondition(
  env: { DB: D1Database },
  input: ChangeConditionInput,
  actor: Actor,
): Promise<void> {
  const db = env.DB;
  if (input.fromCondition === input.toCondition) {
    throw AppError.unprocessable('La condición de destino debe ser distinta de la actual.');
  }
  const material = await requireMaterial(db, input.materialId);
  await requireLocation(db, input.locationId);
  await requireCondition(db, input.fromCondition);
  await requireCondition(db, input.toCondition);

  try {
    await batch(db, [
      // Igual que en el traslado: la fila origen se asegura antes de descontar.
      ensureStockStatement(db, material.id, input.locationId, input.fromCondition),
      ensureStockStatement(db, material.id, input.locationId, input.toCondition),
      decrementStockStatement(db, material.id, input.locationId, input.fromCondition, input.quantity),
      incrementStockStatement(db, material.id, input.locationId, input.toCondition, input.quantity),
      movementStatement(db, {
        type: 'cambio_condicion',
        materialId: material.id,
        code: material.code,
        itemName: material.name,
        quantity: input.quantity,
        fromLocationId: input.locationId,
        toLocationId: input.locationId,
        notes: `${input.fromCondition} → ${input.toCondition}. ${input.notes ?? ''}`.trim(),
        actorUserId: actor.userId,
      }),
    ]);
  } catch (error) {
    stockError(error, 'el cambio de condición');
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.condition_changed',
    entityType: 'material',
    entityId: material.id,
    detail: {
      quantity: input.quantity,
      from: input.fromCondition,
      to: input.toCondition,
      locationId: input.locationId,
    },
    ipHash: actor.ipHash,
  });
}

// ---------------------------------------------------------------------------
// Bajas
// ---------------------------------------------------------------------------

export interface WriteOffInput {
  materialId: number;
  locationId: number;
  conditionCode: ConditionCode;
  quantity: number;
  reason: string;
  authorizedBy: string;
}

export async function writeOff(
  env: { DB: D1Database },
  input: WriteOffInput,
  actor: Actor,
): Promise<{ writeoffId: number }> {
  const db = env.DB;
  const material = await requireMaterial(db, input.materialId);
  await requireLocation(db, input.locationId);
  await requireCondition(db, input.conditionCode);

  let writeoffId = 0;
  try {
    const results = await batch(db, [
      // La fila origen se asegura antes de descontar: si no existiera, la baja
      // registraría un acta sin descontar nada (una baja «fantasma»).
      ensureStockStatement(db, material.id, input.locationId, input.conditionCode),
      stmt(
        db,
        `INSERT INTO writeoffs
           (material_id, code, item_name, quantity, reason, authorized_by, prior_condition, location_id, created_at, actor_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        material.id,
        material.code,
        material.name,
        input.quantity,
        input.reason,
        input.authorizedBy,
        input.conditionCode,
        input.locationId,
        nowIso(),
        actor.userId,
      ),
      decrementStockStatement(db, material.id, input.locationId, input.conditionCode, input.quantity),
      movementStatement(db, {
        type: 'baja',
        materialId: material.id,
        code: material.code,
        itemName: material.name,
        quantity: input.quantity,
        fromLocationId: input.locationId,
        toLocationId: null,
        responsible: input.authorizedBy,
        notes: input.reason,
        actorUserId: actor.userId,
      }),
    ]);
    writeoffId = Number(results[1]?.meta.last_row_id ?? 0);
  } catch (error) {
    stockError(error, 'la baja');
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.written_off',
    entityType: 'writeoff',
    entityId: writeoffId,
    detail: { materialId: material.id, quantity: input.quantity, reason: input.reason },
    ipHash: actor.ipHash,
  });

  return { writeoffId };
}

// ---------------------------------------------------------------------------
// Unidades individuales
// ---------------------------------------------------------------------------

export interface AddUnitInput {
  materialId: number;
  size?: string | null;
  serial?: string | null;
  /** true = identifica una unidad ya contada (no aumenta el total). */
  identify: boolean;
}

export async function addUnit(
  env: { DB: D1Database },
  input: AddUnitInput,
  actor: Actor,
): Promise<{ unitId: number; code: string }> {
  const db = env.DB;
  const material = await requireMaterial(db, input.materialId);
  const serial = input.serial?.trim() || null;

  if (serial && (await materials.findUnitBySerial(db, serial))) {
    throw AppError.conflict('Ese número de serie ya está registrado.');
  }

  const existing = await materials.listUnits(db, material.id);
  const code = `${material.code}-U${String(existing.length + 1).padStart(3, '0')}`;

  try {
    const unitId = await materials.insertUnit(db, {
      materialId: material.id,
      code,
      serial,
      size: input.size?.trim() || null,
      lotId: null,
    });
    await run(db, `UPDATE materials SET is_individual = 1, updated_at = ? WHERE id = ?`, nowIso(), material.id);
    await run(
      db,
      `INSERT INTO movements
         (created_at, movement_type, material_id, unit_id, code, item_name, quantity, notes, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      nowIso(),
      input.identify ? 'identificacion_unidad' : 'ingreso_unidad',
      material.id,
      unitId,
      code,
      material.name,
      `Talla ${input.size ?? '-'} / Serie ${serial ?? '-'}`,
      actor.userId,
    );
    await logAudit(db, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: input.identify ? 'inventory.unit_identified' : 'inventory.unit_added',
      entityType: 'material_unit',
      entityId: unitId,
      detail: { materialId: material.id, code, size: input.size ?? null },
      ipHash: actor.ipHash,
    });
    return { unitId, code };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('La unidad (código o serie) ya existe.');
    }
    throw error;
  }
}
