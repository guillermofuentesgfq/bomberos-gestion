import { batch, stmt } from '../lib/db';
import { nowIso } from '../lib/time';
import { AppError } from '../lib/errors';
import { isCheckViolation, isUniqueViolation } from '../lib/sql';
import { randomId } from '../lib/ids';
import { logAudit } from '../security/audit';
import { movementStatement } from '../repositories/movements';
import * as materialsRepo from '../repositories/materials';
import * as personsRepo from '../repositories/persons';
import * as assignmentsRepo from '../repositories/assignments';
import * as catalog from '../repositories/catalog';
import { AVAILABLE_CONDITION, type ConditionCode } from '../../shared/inventory';
import type { Actor } from '../security/actor';
import { ensureStockStatement, decrementStockStatement, incrementStockStatement } from './inventory';

// ---------------------------------------------------------------------------
// Asignaciones
//
// Toda la operación va en un único `batch()`:
//   1. Se inserta la cabecera de la asignación (con un `batch_id` único).
//   2. Por cada línea: se asegura la fila de existencias, se resta (la
//      restricción `CHECK (quantity >= 0)` impide sobregirar) y se inserta la
//      línea enlazando su cabecera por `batch_id`.
//   3. Se registra el movimiento.
// Si cualquier sentencia falla, se revierte el lote completo.
// ---------------------------------------------------------------------------

export interface AssignLineInput {
  materialId: number;
  unitId?: number | null | undefined;
  locationId: number;
  quantity: number;
  conditionOut?: string | null | undefined;
}

export interface AssignInput {
  personId: number;
  deliveredBy: string;
  notes?: string | null | undefined;
  lines: AssignLineInput[];
}

export interface AssignResult {
  assignmentId: number;
  batchId: string;
  lines: number;
}

export async function assignMaterial(
  env: { DB: D1Database },
  input: AssignInput,
  actor: Actor,
): Promise<AssignResult> {
  const db = env.DB;

  if (input.lines.length === 0) {
    throw AppError.unprocessable('Agrega al menos un material a la entrega.');
  }

  const person = await personsRepo.findPersonById(db, input.personId);
  if (!person) throw AppError.notFound('Persona no encontrada.');

  // Preparamos y validamos cada línea antes de tocar las existencias.
  interface Prepared {
    material: materialsRepo.MaterialRow;
    unitId: number | null;
    size: string | null;
    serial: string | null;
    locationId: number;
    quantity: number;
    conditionOut: string | null;
  }

  const prepared: Prepared[] = [];
  for (const line of input.lines) {
    const material = await materialsRepo.findMaterialById(db, line.materialId);
    if (!material) throw AppError.unprocessable('Uno de los materiales no existe.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw AppError.unprocessable('Las cantidades deben ser enteros mayores que cero.');
    }
    const location = await catalog.findLocation(db, line.locationId);
    if (!location || location.archived_at !== null) {
      throw AppError.unprocessable('Una de las ubicaciones no existe.');
    }

    let size: string | null = null;
    let serial: string | null = null;
    if (line.unitId !== undefined && line.unitId !== null) {
      const units = await materialsRepo.listUnits(db, material.id);
      const unit = units.find((u) => u.id === line.unitId);
      if (!unit) throw AppError.unprocessable('La unidad indicada no pertenece al material.');
      size = unit.size;
      serial = unit.serial;
    }

    prepared.push({
      material,
      unitId: line.unitId ?? null,
      size,
      serial,
      locationId: line.locationId,
      quantity: line.quantity,
      conditionOut: line.conditionOut ?? null,
    });
  }

  const batchId = randomId(12);
  const now = nowIso();

  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `INSERT INTO assignments (person_id, batch_id, delivered_at, delivered_by, notes, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      person.id,
      batchId,
      now,
      input.deliveredBy,
      input.notes ?? null,
      actor.userId,
      now,
    ),
  ];

  for (const line of prepared) {
    statements.push(
      ensureStockStatement(db, line.material.id, line.locationId, AVAILABLE_CONDITION),
      decrementStockStatement(db, line.material.id, line.locationId, AVAILABLE_CONDITION, line.quantity),
      stmt(
        db,
        `INSERT INTO assignment_lines
           (assignment_id, material_id, unit_id, code, item_name, size, serial, quantity, returned_qty, condition_out)
         SELECT id, ?, ?, ?, ?, ?, ?, ?, 0, ? FROM assignments WHERE batch_id = ?`,
        line.material.id,
        line.unitId,
        line.material.code,
        line.material.name,
        line.size,
        line.serial,
        line.quantity,
        line.conditionOut,
        batchId,
      ),
      movementStatement(db, {
        type: 'asignacion',
        materialId: line.material.id,
        unitId: line.unitId,
        code: line.material.code,
        itemName: line.material.name,
        quantity: line.quantity,
        fromLocationId: line.locationId,
        personId: person.id,
        responsible: input.deliveredBy,
        notes: input.notes ?? null,
        actorUserId: actor.userId,
      }),
    );
  }

  try {
    await batch(db, statements);
  } catch (error) {
    if (isCheckViolation(error)) {
      throw AppError.unprocessable('No hay existencias disponibles suficientes para la entrega.');
    }
    if (isUniqueViolation(error)) {
      throw AppError.conflict('La entrega ya fue registrada.');
    }
    throw error;
  }

  const assignment = await assignmentsRepo.listLinesForBatch(db, person.id, batchId);
  const assignmentId = assignment[0]?.assignment_id ?? 0;

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.assigned',
    entityType: 'assignment',
    entityId: assignmentId,
    detail: { personId: person.id, batchId, lines: prepared.length },
    ipHash: actor.ipHash,
  });

  return { assignmentId, batchId, lines: prepared.length };
}

// ---------------------------------------------------------------------------
// Devoluciones (totales y parciales)
// ---------------------------------------------------------------------------

export interface ReturnLineInput {
  assignmentLineId: number;
  quantity: number;
}

export interface ReturnInput {
  personId: number;
  lines: ReturnLineInput[];
  toLocationId: number;
  conditionCode: ConditionCode;
  receivedBy: string;
  notes?: string | null | undefined;
}

export interface ReturnResult {
  returnId: number;
  lines: number;
}

export async function returnMaterial(
  env: { DB: D1Database },
  input: ReturnInput,
  actor: Actor,
): Promise<ReturnResult> {
  const db = env.DB;

  if (input.lines.length === 0) {
    throw AppError.unprocessable('Agrega al menos un material a la devolución.');
  }

  const person = await personsRepo.findPersonById(db, input.personId);
  if (!person) throw AppError.notFound('Persona no encontrada.');

  const location = await catalog.findLocation(db, input.toLocationId);
  if (!location || location.archived_at !== null) {
    throw AppError.unprocessable('La ubicación de destino no existe.');
  }

  interface PreparedReturn {
    line: assignmentsRepo.AssignmentLineRow;
    quantity: number;
  }

  const prepared: PreparedReturn[] = [];
  for (const requested of input.lines) {
    const line = await assignmentsRepo.findLineById(db, requested.assignmentLineId);
    if (!line) throw AppError.unprocessable('Una de las líneas de asignación no existe.');

    const assignment = await db
      .prepare(`SELECT person_id FROM assignments WHERE id = ?`)
      .bind(line.assignment_id)
      .first<{ person_id: number }>();
    if (!assignment || assignment.person_id !== person.id) {
      throw AppError.unprocessable('La línea no pertenece a esta persona.');
    }

    const pending = line.quantity - line.returned_qty;
    if (requested.quantity < 1) {
      throw AppError.unprocessable('Las cantidades deben ser mayores que cero.');
    }
    if (requested.quantity > pending) {
      throw AppError.unprocessable(
        `No se pueden devolver ${requested.quantity} unidades: solo quedan ${pending} pendientes.`,
      );
    }
    prepared.push({ line, quantity: requested.quantity });
  }

  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `INSERT INTO returns
         (assignment_id, person_id, returned_at, received_by, to_location_id, notes, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      prepared[0]?.line.assignment_id ?? null,
      person.id,
      now,
      input.receivedBy,
      input.toLocationId,
      input.notes ?? null,
      actor.userId,
      now,
    ),
  ];

  for (const item of prepared) {
    statements.push(
      assignmentsRepo.incrementReturnedStatement(db, item.line.id, item.quantity),
      ensureStockStatement(db, item.line.material_id, input.toLocationId, input.conditionCode),
      incrementStockStatement(db, item.line.material_id, input.toLocationId, input.conditionCode, item.quantity),
      stmt(
        db,
        `INSERT INTO return_lines (return_id, assignment_line_id, quantity, condition_in, material_id)
         SELECT MAX(id), ?, ?, ?, ? FROM returns`,
        item.line.id,
        item.quantity,
        input.conditionCode,
        item.line.material_id,
      ),
      movementStatement(db, {
        type: 'devolucion',
        materialId: item.line.material_id,
        unitId: item.line.unit_id,
        code: item.line.code,
        itemName: item.line.item_name,
        quantity: item.quantity,
        fromLocationId: null,
        toLocationId: input.toLocationId,
        personId: person.id,
        responsible: input.receivedBy,
        notes: input.notes ?? null,
        actorUserId: actor.userId,
      }),
    );
  }

  try {
    await batch(db, statements);
  } catch (error) {
    if (isCheckViolation(error)) {
      throw AppError.unprocessable('La devolución supera el material pendiente.');
    }
    throw error;
  }

  const created = await db
    .prepare(`SELECT MAX(id) AS id FROM returns`)
    .first<{ id: number }>();

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'inventory.returned',
    entityType: 'return',
    entityId: created?.id ?? null,
    detail: { personId: person.id, lines: prepared.length },
    ipHash: actor.ipHash,
  });

  return { returnId: created?.id ?? 0, lines: prepared.length };
}
