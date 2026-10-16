import { all, stmt } from '../lib/db';
import { nowIso } from '../lib/time';
import type { MovementType } from '../../shared/inventory';

export interface MovementRow {
  id: number;
  created_at: string;
  movement_type: string;
  material_id: number | null;
  unit_id: number | null;
  code: string | null;
  item_name: string | null;
  quantity: number;
  from_location_id: number | null;
  to_location_id: number | null;
  person_id: number | null;
  responsible: string | null;
  notes: string | null;
  actor_user_id: number | null;
}

export interface MovementInput {
  type: MovementType;
  materialId: number | null;
  unitId?: number | null;
  code?: string | null;
  itemName?: string | null;
  quantity: number;
  fromLocationId?: number | null;
  toLocationId?: number | null;
  personId?: number | null;
  responsible?: string | null;
  notes?: string | null;
  actorUserId: number | null;
  idempotencyKey?: string | null;
}

/**
 * Construye (sin ejecutar) la sentencia de inserción de un movimiento, para
 * poder incluirla dentro de un `batch()` transaccional.
 */
export function movementStatement(
  db: D1Database,
  input: MovementInput,
): D1PreparedStatement {
  return stmt(
    db,
    `INSERT INTO movements
       (created_at, movement_type, material_id, unit_id, code, item_name, quantity,
        from_location_id, to_location_id, person_id, responsible, notes, actor_user_id, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(),
    input.type,
    input.materialId,
    input.unitId ?? null,
    input.code ?? null,
    input.itemName ?? null,
    input.quantity,
    input.fromLocationId ?? null,
    input.toLocationId ?? null,
    input.personId ?? null,
    input.responsible ?? null,
    input.notes ?? null,
    input.actorUserId,
    input.idempotencyKey ?? null,
  );
}

export async function listMovements(db: D1Database, limit = 200): Promise<MovementRow[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  return all<MovementRow>(
    db,
    `SELECT id, created_at, movement_type, material_id, unit_id, code, item_name, quantity,
            from_location_id, to_location_id, person_id, responsible, notes, actor_user_id
       FROM movements
      ORDER BY id DESC
      LIMIT ?`,
    capped,
  );
}

export async function listMovementsForMaterial(
  db: D1Database,
  materialId: number,
  limit = 100,
): Promise<MovementRow[]> {
  return all<MovementRow>(
    db,
    `SELECT id, created_at, movement_type, material_id, unit_id, code, item_name, quantity,
            from_location_id, to_location_id, person_id, responsible, notes, actor_user_id
       FROM movements
      WHERE material_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    materialId,
    Math.min(Math.max(limit, 1), 500),
  );
}
