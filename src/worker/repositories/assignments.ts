import { all, first } from '../lib/db';

export interface AssignmentRow {
  id: number;
  person_id: number;
  batch_id: string;
  delivered_at: string;
  delivered_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface AssignmentLineRow {
  id: number;
  assignment_id: number;
  material_id: number;
  unit_id: number | null;
  code: string;
  item_name: string;
  size: string | null;
  serial: string | null;
  quantity: number;
  returned_qty: number;
  condition_out: string | null;
}

export async function insertAssignment(
  db: D1Database,
  input: {
    personId: number;
    batchId: string;
    deliveredAt: string;
    deliveredBy: string | null;
    notes: string | null;
    actorUserId: number | null;
    createdAt: string;
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO assignments
         (person_id, batch_id, delivered_at, delivered_by, notes, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.personId,
      input.batchId,
      input.deliveredAt,
      input.deliveredBy,
      input.notes,
      input.actorUserId,
      input.createdAt,
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function insertAssignmentLine(
  db: D1Database,
  input: {
    assignmentId: number;
    materialId: number;
    unitId: number | null;
    code: string;
    itemName: string;
    size: string | null;
    serial: string | null;
    quantity: number;
    conditionOut: string | null;
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO assignment_lines
         (assignment_id, material_id, unit_id, code, item_name, size, serial, quantity, returned_qty, condition_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(
      input.assignmentId,
      input.materialId,
      input.unitId,
      input.code,
      input.itemName,
      input.size,
      input.serial,
      input.quantity,
      input.conditionOut,
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function findLineById(
  db: D1Database,
  lineId: number,
): Promise<AssignmentLineRow | null> {
  return first<AssignmentLineRow>(
    db,
    `SELECT id, assignment_id, material_id, unit_id, code, item_name, size, serial,
            quantity, returned_qty, condition_out
       FROM assignment_lines WHERE id = ?`,
    lineId,
  );
}

export interface PersonAssignmentLine extends AssignmentLineRow {
  batch_id: string;
  delivered_at: string;
  delivered_by: string | null;
}

/** Líneas asignadas a una persona con saldo pendiente. */
export async function listPendingLinesForPerson(
  db: D1Database,
  personId: number,
): Promise<PersonAssignmentLine[]> {
  return all<PersonAssignmentLine>(
    db,
    `SELECT al.id, al.assignment_id, al.material_id, al.unit_id, al.code, al.item_name,
            al.size, al.serial, al.quantity, al.returned_qty, al.condition_out,
            a.batch_id, a.delivered_at, a.delivered_by
       FROM assignment_lines al
       JOIN assignments a ON a.id = al.assignment_id
      WHERE a.person_id = ? AND al.returned_qty < al.quantity
      ORDER BY a.delivered_at DESC, al.id`,
    personId,
  );
}

export async function listLinesForBatch(
  db: D1Database,
  personId: number,
  batchId: string,
): Promise<AssignmentLineRow[]> {
  return all<AssignmentLineRow>(
    db,
    `SELECT al.id, al.assignment_id, al.material_id, al.unit_id, al.code, al.item_name,
            al.size, al.serial, al.quantity, al.returned_qty, al.condition_out
       FROM assignment_lines al
       JOIN assignments a ON a.id = al.assignment_id
      WHERE a.person_id = ? AND a.batch_id = ?
      ORDER BY al.id`,
    personId,
    batchId,
  );
}

/** Cabecera de una entrega (un `batch_id` de una persona), para su acta. */
export async function findAssignmentByBatch(
  db: D1Database,
  personId: number,
  batchId: string,
): Promise<AssignmentRow | null> {
  return first<AssignmentRow>(
    db,
    `SELECT id, person_id, batch_id, delivered_at, delivered_by, notes, created_at
       FROM assignments
      WHERE person_id = ? AND batch_id = ?
      ORDER BY id
      LIMIT 1`,
    personId,
    batchId,
  );
}

export async function insertReturn(
  db: D1Database,
  input: {
    assignmentId: number | null;
    personId: number;
    returnedAt: string;
    receivedBy: string | null;
    toLocationId: number;
    notes: string | null;
    actorUserId: number | null;
    createdAt: string;
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO returns
         (assignment_id, person_id, returned_at, received_by, to_location_id, notes, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.assignmentId,
      input.personId,
      input.returnedAt,
      input.receivedBy,
      input.toLocationId,
      input.notes,
      input.actorUserId,
      input.createdAt,
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function insertReturnLine(
  db: D1Database,
  input: {
    returnId: number;
    assignmentLineId: number;
    quantity: number;
    conditionIn: string | null;
    materialId: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO return_lines (return_id, assignment_line_id, quantity, condition_in, material_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.returnId,
      input.assignmentLineId,
      input.quantity,
      input.conditionIn,
      input.materialId,
    )
    .run();
}

/** Actualiza el saldo devuelto de una línea. Falla si excede lo pendiente. */
export function incrementReturnedStatement(
  db: D1Database,
  lineId: number,
  quantity: number,
): D1PreparedStatement {
  return db
    .prepare(`UPDATE assignment_lines SET returned_qty = returned_qty + ? WHERE id = ?`)
    .bind(quantity, lineId);
}
