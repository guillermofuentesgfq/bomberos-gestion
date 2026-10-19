/**
 * Acceso a D1 del apartado de postulaciones.
 *
 * Solo SQL parametrizado. Las reglas (estados, límites, conversión a ficha)
 * viven en `services/applicants.ts`.
 */

import { all, changedRows, first, run } from '../lib/db';
import { nowIso } from '../lib/time';

export interface ApplicantRow {
  id: number;
  full_name: string;
  rut: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  commune: string | null;
  motivation: string | null;
  availability: string | null;
  status: string;
  consent_at: string;
  ip_hash: string | null;
  person_id: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ApplicantNoteRow {
  id: number;
  applicant_id: number;
  author_user_id: number | null;
  body: string;
  created_at: string;
}

export interface ApplicantContactRow {
  id: number;
  applicant_id: number;
  channel: string;
  summary: string;
  contacted_at: string;
  created_by: number | null;
  created_at: string;
}

const APPLICANT_COLUMNS = `id, full_name, rut, birth_date, email, phone, address, commune,
  motivation, availability, status, consent_at, ip_hash, person_id, created_at, updated_at, archived_at`;

export interface ListApplicantsFilter {
  status?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}

export async function listApplicants(
  db: D1Database,
  filter: ListApplicantsFilter = {},
): Promise<ApplicantRow[]> {
  const where: string[] = ['archived_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.search) {
    // El término se acota antes de construir el patrón: sin cota, un `q` enorme
    // alimentaría un LIKE costoso. Se usa LIKE directo (no `likePattern`) para
    // no depender del escape de comodines del usuario.
    const term = `%${filter.search.slice(0, 120).replace(/[%_]/g, '')}%`;
    where.push('(full_name LIKE ? OR rut LIKE ? OR email LIKE ? OR commune LIKE ?)');
    params.push(term, term, term, term);
  }

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  params.push(limit);
  return all<ApplicantRow>(
    db,
    `SELECT ${APPLICANT_COLUMNS} FROM applicants
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE status WHEN 'nuevo' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END,
        created_at DESC
      LIMIT ?`,
    ...params,
  );
}

export async function findApplicantById(db: D1Database, id: number): Promise<ApplicantRow | null> {
  return first<ApplicantRow>(
    db,
    `SELECT ${APPLICANT_COLUMNS} FROM applicants WHERE id = ? AND archived_at IS NULL`,
    id,
  );
}

export interface NewApplicant {
  fullName: string;
  rut: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  commune: string | null;
  motivation: string | null;
  availability: string | null;
  ipHash: string | null;
}

export async function insertApplicant(db: D1Database, input: NewApplicant): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO applicants
       (full_name, rut, birth_date, email, phone, address, commune, motivation, availability,
        status, consent_at, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nuevo', ?, ?, ?, ?)`,
    input.fullName,
    input.rut,
    input.birthDate,
    input.email,
    input.phone,
    input.address,
    input.commune,
    input.motivation,
    input.availability,
    now,
    input.ipHash,
    now,
    now,
  );
  return Number(result.meta.last_row_id);
}

/** ¿Ya hay una postulación con ese RUT o correo en los últimos días? */
export async function recentDuplicate(
  db: D1Database,
  rut: string | null,
  email: string | null,
  sinceIso: string,
): Promise<boolean> {
  if (!rut && !email) return false;
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM applicants
      WHERE created_at >= ?
        AND ((? IS NOT NULL AND rut = ?) OR (? IS NOT NULL AND email = ?))`,
    sinceIso,
    rut,
    rut,
    email,
    email,
  );
  return (row?.n ?? 0) > 0;
}

export async function updateApplicantStatus(
  db: D1Database,
  id: number,
  status: string,
  personId?: number | null,
): Promise<number> {
  if (personId === undefined) {
    return changedRows(
      db,
      `UPDATE applicants SET status = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
      status,
      nowIso(),
      id,
    );
  }
  return changedRows(
    db,
    `UPDATE applicants SET status = ?, person_id = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    status,
    personId,
    nowIso(),
    id,
  );
}

export async function archiveApplicant(db: D1Database, id: number): Promise<number> {
  const now = nowIso();
  return changedRows(
    db,
    `UPDATE applicants SET archived_at = ?, status = 'archivado', updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    now,
    now,
    id,
  );
}

export async function insertNote(
  db: D1Database,
  applicantId: number,
  authorUserId: number | null,
  body: string,
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO applicant_notes (applicant_id, author_user_id, body, created_at)
     VALUES (?, ?, ?, ?)`,
    applicantId,
    authorUserId,
    body,
    nowIso(),
  );
  return Number(result.meta.last_row_id);
}

export async function listNotes(db: D1Database, applicantId: number): Promise<ApplicantNoteRow[]> {
  return all<ApplicantNoteRow>(
    db,
    `SELECT id, applicant_id, author_user_id, body, created_at
       FROM applicant_notes WHERE applicant_id = ? ORDER BY id`,
    applicantId,
  );
}

export async function insertContact(
  db: D1Database,
  input: {
    applicantId: number;
    channel: string;
    summary: string;
    contactedAt: string;
    userId: number | null;
  },
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO applicant_contacts (applicant_id, channel, summary, contacted_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.applicantId,
    input.channel,
    input.summary,
    input.contactedAt,
    input.userId,
    nowIso(),
  );
  return Number(result.meta.last_row_id);
}

export async function listContacts(
  db: D1Database,
  applicantId: number,
): Promise<ApplicantContactRow[]> {
  return all<ApplicantContactRow>(
    db,
    `SELECT id, applicant_id, channel, summary, contacted_at, created_by, created_at
       FROM applicant_contacts WHERE applicant_id = ? ORDER BY contacted_at DESC, id DESC`,
    applicantId,
  );
}

export async function countByStatus(
  db: D1Database,
): Promise<{ status: string; n: number }[]> {
  return all<{ status: string; n: number }>(
    db,
    `SELECT status, COUNT(*) AS n FROM applicants WHERE archived_at IS NULL GROUP BY status`,
  );
}

// --- Limitador de peticiones -------------------------------------------------

/** Cuenta los eventos de un cubo para una clave desde un instante. */
export async function countThrottle(
  db: D1Database,
  bucket: string,
  keyHash: string,
  sinceIso: string,
): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM throttle_events
      WHERE bucket = ? AND key_hash = ? AND created_at >= ?`,
    bucket,
    keyHash,
    sinceIso,
  );
  return row?.n ?? 0;
}

export async function recordThrottle(
  db: D1Database,
  bucket: string,
  keyHash: string,
): Promise<void> {
  await run(
    db,
    `INSERT INTO throttle_events (bucket, key_hash, created_at) VALUES (?, ?, ?)`,
    bucket,
    keyHash,
    nowIso(),
  );
}
