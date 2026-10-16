import { all, first, run } from '../lib/db';
import { nowIso } from '../lib/time';

export interface PersonRow {
  id: number;
  full_name: string;
  rut: string | null;
  quality_id: number | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  join_date: string | null;
  registry_no: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  history: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PositionRow {
  id: number;
  person_id: number;
  position_type_id: number | null;
  position_label: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
}

const PERSON_COLUMNS = `id, full_name, rut, quality_id, phone, email, address, birth_date,
  join_date, registry_no, emergency_name, emergency_phone, history, is_active,
  created_at, updated_at, archived_at`;

export async function listPersons(db: D1Database, search?: string): Promise<PersonRow[]> {
  if (search) {
    const like = `%${search}%`;
    return all<PersonRow>(
      db,
      `SELECT ${PERSON_COLUMNS} FROM persons
        WHERE archived_at IS NULL AND (full_name LIKE ? OR rut LIKE ? OR phone LIKE ?)
        ORDER BY full_name`,
      like,
      like,
      like,
    );
  }
  return all<PersonRow>(
    db,
    `SELECT ${PERSON_COLUMNS} FROM persons WHERE archived_at IS NULL ORDER BY full_name`,
  );
}

export async function findPersonById(db: D1Database, id: number): Promise<PersonRow | null> {
  return first<PersonRow>(
    db,
    `SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ? AND archived_at IS NULL`,
    id,
  );
}

export interface PersonActaHeader {
  id: number;
  full_name: string;
  rut: string | null;
  registry_no: string | null;
  quality_name: string | null;
}

/** Datos mínimos de la persona para el encabezado de un acta. */
export async function findPersonForActa(
  db: D1Database,
  id: number,
): Promise<PersonActaHeader | null> {
  return first<PersonActaHeader>(
    db,
    `SELECT p.id, p.full_name, p.rut, p.registry_no, q.name AS quality_name
       FROM persons p
       LEFT JOIN qualities q ON q.id = p.quality_id
      WHERE p.id = ? AND p.archived_at IS NULL`,
    id,
  );
}

export interface PersonInput {
  fullName: string;
  rut?: string | null | undefined;
  qualityId?: number | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  birthDate?: string | null | undefined;
  joinDate?: string | null | undefined;
  registryNo?: string | null | undefined;
  emergencyName?: string | null | undefined;
  emergencyPhone?: string | null | undefined;
  history?: string | null | undefined;
  isActive?: boolean | undefined;
}

export async function insertPerson(db: D1Database, input: PersonInput): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO persons
       (full_name, rut, quality_id, phone, email, address, birth_date, join_date, registry_no,
        emergency_name, emergency_phone, history, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.fullName,
    input.rut ?? null,
    input.qualityId ?? null,
    input.phone ?? null,
    input.email ?? null,
    input.address ?? null,
    input.birthDate ?? null,
    input.joinDate ?? null,
    input.registryNo ?? null,
    input.emergencyName ?? null,
    input.emergencyPhone ?? null,
    input.history ?? null,
    input.isActive === false ? 0 : 1,
    now,
    now,
  );
  return Number(result.meta.last_row_id);
}

export async function updatePerson(
  db: D1Database,
  id: number,
  input: PersonInput,
): Promise<void> {
  await run(
    db,
    `UPDATE persons SET
       full_name = ?, rut = ?, quality_id = ?, phone = ?, email = ?, address = ?,
       birth_date = ?, join_date = ?, registry_no = ?, emergency_name = ?, emergency_phone = ?,
       history = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
    input.fullName,
    input.rut ?? null,
    input.qualityId ?? null,
    input.phone ?? null,
    input.email ?? null,
    input.address ?? null,
    input.birthDate ?? null,
    input.joinDate ?? null,
    input.registryNo ?? null,
    input.emergencyName ?? null,
    input.emergencyPhone ?? null,
    input.history ?? null,
    input.isActive === false ? 0 : 1,
    nowIso(),
    id,
  );
}

export async function archivePerson(db: D1Database, id: number): Promise<void> {
  await run(db, `UPDATE persons SET archived_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), id);
}

// --- Cargos -----------------------------------------------------------------

export async function listPositions(db: D1Database, personId: number): Promise<PositionRow[]> {
  return all<PositionRow>(
    db,
    `SELECT id, person_id, position_type_id, position_label, start_date, end_date, notes, created_at, archived_at
       FROM person_positions
      WHERE person_id = ? AND archived_at IS NULL
      ORDER BY COALESCE(start_date, '') DESC, id DESC`,
    personId,
  );
}

export async function insertPosition(
  db: D1Database,
  position: {
    personId: number;
    positionTypeId: number | null;
    positionLabel: string | null;
    startDate: string | null;
    endDate: string | null;
    notes: string | null;
  },
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO person_positions
       (person_id, position_type_id, position_label, start_date, end_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    position.personId,
    position.positionTypeId,
    position.positionLabel,
    position.startDate,
    position.endDate,
    position.notes,
    nowIso(),
  );
  return Number(result.meta.last_row_id);
}

export async function archivePosition(
  db: D1Database,
  personId: number,
  positionId: number,
): Promise<number> {
  const result = await run(
    db,
    `UPDATE person_positions SET archived_at = ?
      WHERE id = ? AND person_id = ? AND archived_at IS NULL`,
    nowIso(),
    positionId,
    personId,
  );
  return result.meta.changes ?? 0;
}

export async function listPositionTypes(db: D1Database): Promise<{ id: number; name: string }[]> {
  return all<{ id: number; name: string }>(
    db,
    `SELECT id, name FROM position_types WHERE archived_at IS NULL ORDER BY sort_order, name`,
  );
}

export async function listQualities(db: D1Database): Promise<{ id: number; name: string }[]> {
  return all<{ id: number; name: string }>(
    db,
    `SELECT id, name FROM qualities WHERE archived_at IS NULL ORDER BY sort_order, name`,
  );
}

// --- Administración del catálogo de personas --------------------------------

export async function insertPositionType(db: D1Database, name: string): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO position_types (name, sort_order) VALUES (?, 0)`,
    name,
  );
  return Number(result.meta.last_row_id);
}

export async function updatePositionType(
  db: D1Database,
  id: number,
  name: string,
): Promise<number> {
  const result = await run(
    db,
    `UPDATE position_types SET name = ? WHERE id = ? AND archived_at IS NULL`,
    name,
    id,
  );
  return result.meta.changes ?? 0;
}

/** Archiva, no borra: los cargos ya asignados conservan su referencia. */
export async function archivePositionType(db: D1Database, id: number): Promise<number> {
  const result = await run(
    db,
    `UPDATE position_types SET archived_at = ? WHERE id = ? AND archived_at IS NULL`,
    nowIso(),
    id,
  );
  return result.meta.changes ?? 0;
}

export async function insertQuality(db: D1Database, name: string): Promise<number> {
  const result = await run(db, `INSERT INTO qualities (name, sort_order) VALUES (?, 0)`, name);
  return Number(result.meta.last_row_id);
}

export async function updateQuality(db: D1Database, id: number, name: string): Promise<number> {
  const result = await run(
    db,
    `UPDATE qualities SET name = ? WHERE id = ? AND archived_at IS NULL`,
    name,
    id,
  );
  return result.meta.changes ?? 0;
}

export async function archiveQuality(db: D1Database, id: number): Promise<number> {
  const result = await run(
    db,
    `UPDATE qualities SET archived_at = ? WHERE id = ? AND archived_at IS NULL`,
    nowIso(),
    id,
  );
  return result.meta.changes ?? 0;
}

// --- Ficha imprimible -------------------------------------------------------

export interface PersonFichaRow extends PersonRow {
  quality_name: string | null;
}

/** La persona con el nombre de su calidad, para la ficha imprimible. */
export async function findPersonForFicha(
  db: D1Database,
  id: number,
): Promise<PersonFichaRow | null> {
  return first<PersonFichaRow>(
    db,
    `SELECT p.id, p.full_name, p.rut, p.quality_id, p.phone, p.email, p.address,
            p.birth_date, p.join_date, p.registry_no, p.emergency_name, p.emergency_phone,
            p.history, p.is_active, p.created_at, p.updated_at, p.archived_at,
            q.name AS quality_name
       FROM persons p
       LEFT JOIN qualities q ON q.id = p.quality_id
      WHERE p.id = ? AND p.archived_at IS NULL`,
    id,
  );
}

export interface PositionWithTypeRow extends PositionRow {
  type_name: string | null;
}

/** Cargos de una persona con el nombre del tipo de cargo ya resuelto. */
export async function listPositionsWithType(
  db: D1Database,
  personId: number,
): Promise<PositionWithTypeRow[]> {
  return all<PositionWithTypeRow>(
    db,
    `SELECT pp.id, pp.person_id, pp.position_type_id, pp.position_label, pp.start_date,
            pp.end_date, pp.notes, pp.created_at, pp.archived_at,
            pt.name AS type_name
       FROM person_positions pp
       LEFT JOIN position_types pt ON pt.id = pp.position_type_id
      WHERE pp.person_id = ? AND pp.archived_at IS NULL
      ORDER BY COALESCE(pp.start_date, '') DESC, pp.id DESC`,
    personId,
  );
}
