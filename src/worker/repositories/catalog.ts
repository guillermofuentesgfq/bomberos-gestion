import { all, first, run } from '../lib/db';

export interface LocationRow {
  id: number;
  name: string;
  is_archive: number;
  archived_at: string | null;
}

export interface CategoryRow {
  id: number;
  name: string;
}

export interface MaterialTypeRow {
  id: number;
  name: string;
  category_id: number | null;
}

export interface ConditionRow {
  code: string;
  name: string;
  is_available: number;
}

export async function listLocations(db: D1Database): Promise<LocationRow[]> {
  return all<LocationRow>(
    db,
    `SELECT id, name, is_archive, archived_at FROM locations
      WHERE archived_at IS NULL ORDER BY sort_order, name`,
  );
}

export async function listCategories(db: D1Database): Promise<CategoryRow[]> {
  return all<CategoryRow>(
    db,
    `SELECT id, name FROM categories WHERE archived_at IS NULL ORDER BY sort_order, name`,
  );
}

export async function listMaterialTypes(db: D1Database): Promise<MaterialTypeRow[]> {
  return all<MaterialTypeRow>(
    db,
    `SELECT id, name, category_id FROM material_types
      WHERE archived_at IS NULL ORDER BY sort_order, name`,
  );
}

export async function listConditions(db: D1Database): Promise<ConditionRow[]> {
  return all<ConditionRow>(
    db,
    `SELECT code, name, is_available FROM material_conditions ORDER BY sort_order`,
  );
}

export async function findLocation(db: D1Database, id: number): Promise<LocationRow | null> {
  return first<LocationRow>(
    db,
    `SELECT id, name, is_archive, archived_at FROM locations WHERE id = ?`,
    id,
  );
}

export async function conditionExists(db: D1Database, code: string): Promise<boolean> {
  const row = await first<{ code: string }>(
    db,
    `SELECT code FROM material_conditions WHERE code = ?`,
    code,
  );
  return row !== null;
}

/** Código legible para una ubicación (usado en movimientos y actas). */
export async function locationName(db: D1Database, id: number | null): Promise<string | null> {
  if (id === null) return null;
  const row = await first<{ name: string }>(db, `SELECT name FROM locations WHERE id = ?`, id);
  return row?.name ?? null;
}

export async function insertLocation(
  db: D1Database,
  name: string,
  description: string | null,
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO locations (name, description, sort_order) VALUES (?, ?, 0)`,
    name,
    description,
  );
  return Number(result.meta.last_row_id);
}

export async function insertCategory(db: D1Database, name: string): Promise<number> {
  const result = await run(db, `INSERT INTO categories (name, sort_order) VALUES (?, 0)`, name);
  return Number(result.meta.last_row_id);
}
