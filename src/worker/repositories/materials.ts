import { all, first, run } from '../lib/db';
import { nowIso } from '../lib/time';

export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  material_type_id: number | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  min_stock: number;
  is_individual: number;
  photo_object_id: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface UnitRow {
  id: number;
  material_id: number;
  code: string;
  serial: string | null;
  size: string | null;
  lot_id: number | null;
  created_at: string;
  archived_at: string | null;
}

export interface StockRow {
  id: number;
  material_id: number;
  location_id: number;
  condition_code: string;
  quantity: number;
}

const MATERIAL_COLUMNS = `id, code, name, category_id, material_type_id, brand, model, notes,
  min_stock, is_individual, photo_object_id, created_at, updated_at, archived_at`;

export async function findMaterialById(db: D1Database, id: number): Promise<MaterialRow | null> {
  return first<MaterialRow>(
    db,
    `SELECT ${MATERIAL_COLUMNS} FROM materials WHERE id = ? AND archived_at IS NULL`,
    id,
  );
}

export async function findMaterialByCode(db: D1Database, code: string): Promise<MaterialRow | null> {
  return first<MaterialRow>(
    db,
    `SELECT ${MATERIAL_COLUMNS} FROM materials WHERE code = ? COLLATE NOCASE AND archived_at IS NULL`,
    code,
  );
}

export interface MaterialFilter {
  search?: string;
  categoryId?: number;
  locationId?: number;
  includeArchived?: boolean;
  limit?: number;
}

export async function listMaterials(
  db: D1Database,
  filter: MaterialFilter = {},
): Promise<MaterialRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filter.includeArchived) where.push('m.archived_at IS NULL');
  if (filter.search) {
    where.push('(m.name LIKE ? OR m.code LIKE ? OR m.brand LIKE ? OR m.model LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }
  if (filter.categoryId !== undefined) {
    where.push('m.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.locationId !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM stock_levels s WHERE s.material_id = m.id AND s.location_id = ? AND s.quantity > 0)`,
    );
    params.push(filter.locationId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  params.push(limit);

  return all<MaterialRow>(
    db,
    `SELECT ${MATERIAL_COLUMNS.split(',')
      .map((c) => `m.${c.trim()}`)
      .join(', ')}
       FROM materials m
       ${clause}
      ORDER BY m.name, m.code
      LIMIT ?`,
    ...params,
  );
}

export interface NewMaterial {
  code: string;
  name: string;
  categoryId: number | null;
  materialTypeId: number | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  minStock: number;
  isIndividual: boolean;
  photoObjectId?: number | null | undefined;
}

export async function insertMaterial(db: D1Database, material: NewMaterial): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO materials
       (code, name, category_id, material_type_id, brand, model, notes, min_stock, is_individual, photo_object_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    material.code,
    material.name,
    material.categoryId,
    material.materialTypeId,
    material.brand,
    material.model,
    material.notes,
    material.minStock,
    material.isIndividual ? 1 : 0,
    material.photoObjectId ?? null,
    now,
    now,
  );
  return Number(result.meta.last_row_id);
}

/** Cambio parcial de un material: los campos ausentes conservan su valor. */
export interface MaterialUpdate {
  code?: string | undefined;
  name?: string | undefined;
  categoryId?: number | null | undefined;
  materialTypeId?: number | null | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
  minStock?: number | undefined;
  isIndividual?: boolean | undefined;
  photoObjectId?: number | null | undefined;
}

export async function updateMaterial(
  db: D1Database,
  id: number,
  update: MaterialUpdate,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  const assign = (column: string, value: unknown): void => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (update.code !== undefined) assign('code', update.code);
  if (update.name !== undefined) assign('name', update.name);
  if (update.categoryId !== undefined) assign('category_id', update.categoryId);
  if (update.materialTypeId !== undefined) assign('material_type_id', update.materialTypeId);
  if (update.brand !== undefined) assign('brand', update.brand);
  if (update.model !== undefined) assign('model', update.model);
  if (update.notes !== undefined) assign('notes', update.notes);
  if (update.minStock !== undefined) assign('min_stock', update.minStock);
  if (update.isIndividual !== undefined) assign('is_individual', update.isIndividual ? 1 : 0);
  if (update.photoObjectId !== undefined) assign('photo_object_id', update.photoObjectId);

  assign('updated_at', nowIso());
  params.push(id);

  await run(db, `UPDATE materials SET ${assignments.join(', ')} WHERE id = ?`, ...params);
}

export async function archiveMaterial(db: D1Database, id: number): Promise<void> {
  await run(db, `UPDATE materials SET archived_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), id);
}

/** Existencias de un material, con el nombre de la ubicación. */
export interface StockWithLocation {
  id: number;
  location_id: number;
  location_name: string;
  condition_code: string;
  quantity: number;
}

export async function listStock(db: D1Database, materialId: number): Promise<StockWithLocation[]> {
  return all<StockWithLocation>(
    db,
    `SELECT s.id, s.location_id, l.name AS location_name, s.condition_code, s.quantity
       FROM stock_levels s
       JOIN locations l ON l.id = s.location_id
      WHERE s.material_id = ?
      ORDER BY l.sort_order, l.name, s.condition_code`,
    materialId,
  );
}

export async function getStockQuantity(
  db: D1Database,
  materialId: number,
  locationId: number,
  conditionCode: string,
): Promise<number> {
  const row = await first<{ quantity: number }>(
    db,
    `SELECT quantity FROM stock_levels
      WHERE material_id = ? AND location_id = ? AND condition_code = ?`,
    materialId,
    locationId,
    conditionCode,
  );
  return row?.quantity ?? 0;
}

export async function listUnits(db: D1Database, materialId: number): Promise<UnitRow[]> {
  return all<UnitRow>(
    db,
    `SELECT id, material_id, code, serial, size, lot_id, created_at, archived_at
       FROM material_units
      WHERE material_id = ? AND archived_at IS NULL
      ORDER BY code`,
    materialId,
  );
}

export async function findUnitBySerial(db: D1Database, serial: string): Promise<UnitRow | null> {
  return first<UnitRow>(
    db,
    `SELECT id, material_id, code, serial, size, lot_id, created_at, archived_at
       FROM material_units WHERE serial = ? COLLATE NOCASE AND archived_at IS NULL`,
    serial,
  );
}

export async function insertUnit(
  db: D1Database,
  unit: { materialId: number; code: string; serial: string | null; size: string | null; lotId: number | null },
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO material_units (material_id, code, serial, size, lot_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    unit.materialId,
    unit.code,
    unit.serial,
    unit.size,
    unit.lotId,
    nowIso(),
  );
  return Number(result.meta.last_row_id);
}

export async function insertLot(
  db: D1Database,
  lot: { code: string; materialId: number; notes: string | null },
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO lots (code, material_id, notes, created_at) VALUES (?, ?, ?, ?)`,
    lot.code,
    lot.materialId,
    lot.notes,
    nowIso(),
  );
  return Number(result.meta.last_row_id);
}

/** Resumen agregado por material: total, disponible y no disponible. */
export interface StockSummaryRow {
  material_id: number;
  total: number;
  available: number;
}

export async function stockSummary(db: D1Database): Promise<StockSummaryRow[]> {
  return all<StockSummaryRow>(
    db,
    `SELECT s.material_id,
            COALESCE(SUM(s.quantity), 0) AS total,
            COALESCE(SUM(CASE WHEN c.is_available = 1 THEN s.quantity ELSE 0 END), 0) AS available
       FROM stock_levels s
       JOIN material_conditions c ON c.code = s.condition_code
      GROUP BY s.material_id`,
  );
}
