/**
 * Postulaciones recibidas desde el sitio público.
 *
 * El formulario es anónimo, así que la defensa es: mismo origen (middleware),
 * límite por IP, duplicado silencioso y validación estricta de longitudes. Lo
 * que llega se revisa en el panel, se contacta de forma interna y puede
 * convertirse en ficha de integrante.
 *
 * **No se envía correo.** El aviso llega al grupo de Telegram configurado por
 * la instalación (ver `services/notifications.ts`).
 */

import { AppError } from '../lib/errors';
import { nowIso } from '../lib/time';
import { logAudit } from '../security/audit';
import * as repo from '../repositories/applicants';
import * as personsRepo from '../repositories/persons';
import { normalizeRut, parseDate } from './imports';
import type { Actor } from '../security/actor';

/** Estados válidos y su etiqueta para el panel. */
export const APPLICANT_STATUSES = [
  'nuevo',
  'en_revision',
  'contactado',
  'entrevista',
  'aceptado',
  'rechazado',
  'archivado',
] as const;

export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
  nuevo: 'Nuevo',
  en_revision: 'En revisión',
  contactado: 'Contactado',
  entrevista: 'Entrevista',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  archivado: 'Archivado',
};

/** Canales de contacto interno. No hay correo. */
export const CONTACT_CHANNELS = ['telefono', 'whatsapp', 'presencial', 'otro'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Límites de envío por IP. */
const THROTTLE_BUCKET = 'applicant';
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 20;
/** Ventana de duplicado silencioso: el mismo RUT o correo no vuelve a entrar. */
const DUPLICATE_WINDOW_DAYS = 30;

export interface SubmitInput {
  fullName: string;
  rut?: string | undefined;
  birthDate?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  commune?: string | undefined;
  motivation?: string | undefined;
  availability?: string | undefined;
  consent: boolean;
  /** Campo trampa: si llega con contenido, es un bot. */
  honeypot?: string | undefined;
}

export interface SubmitResult {
  /** Identificador creado, o `null` si se descartó en silencio (robot o duplicado). */
  id: number | null;
  /** Indicador para que la ruta decida si notifica. */
  stored: boolean;
}

function mapStatus(raw: string): ApplicantStatus {
  return (APPLICANT_STATUSES as readonly string[]).includes(raw)
    ? (raw as ApplicantStatus)
    : 'nuevo';
}

/**
 * Registra una postulación.
 *
 * Devuelve siempre el mismo resultado genérico: un robot o un duplicado no
 * reciben información distinta de la de un envío correcto. No notifica: la
 * ruta decide hacerlo con `ctx.waitUntil()`.
 */
export async function submitApplication(
  db: D1Database,
  input: SubmitInput,
  ipHash: string,
): Promise<SubmitResult> {
  // Trampa para bots: se descarta sin dejar rastro distinguible.
  if (input.honeypot && input.honeypot.trim().length > 0) {
    return { id: null, stored: false };
  }

  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [lastHour, lastDay] = await Promise.all([
    repo.countThrottle(db, THROTTLE_BUCKET, ipHash, hourAgo),
    repo.countThrottle(db, THROTTLE_BUCKET, ipHash, dayAgo),
  ]);
  if (lastHour >= MAX_PER_HOUR || lastDay >= MAX_PER_DAY) {
    throw AppError.tooManyRequests('Se recibieron demasiadas postulaciones desde esta conexión. Inténtalo más tarde.');
  }
  await repo.recordThrottle(db, THROTTLE_BUCKET, ipHash);

  const rutRaw = (input.rut ?? '').trim();
  let rut: string | null = null;
  if (rutRaw.length > 0) {
    const normalized = normalizeRut(rutRaw);
    if ('error' in normalized) throw AppError.unprocessable(normalized.error);
    rut = normalized.value;
  }

  const birthRaw = (input.birthDate ?? '').trim();
  const birthDate = birthRaw.length > 0 ? parseDate(birthRaw) : null;
  if (birthRaw.length > 0 && birthDate === null) {
    throw AppError.unprocessable('La fecha de nacimiento no es válida.');
  }

  const email = (input.email ?? '').trim() || null;
  const since = new Date(now - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  if (await repo.recentDuplicate(db, rut, email, since)) {
    return { id: null, stored: false };
  }

  const id = await repo.insertApplicant(db, {
    fullName: input.fullName.trim(),
    rut,
    birthDate,
    email,
    phone: (input.phone ?? '').trim() || null,
    address: (input.address ?? '').trim() || null,
    commune: (input.commune ?? '').trim() || null,
    motivation: (input.motivation ?? '').trim() || null,
    availability: (input.availability ?? '').trim() || null,
    ipHash,
  });

  await logAudit(db, {
    actorUserId: null,
    actorLabel: 'sitio público',
    action: 'applicants.submitted',
    entityType: 'applicant',
    entityId: id,
    detail: { hasRut: rut !== null, hasEmail: email !== null },
    ipHash,
  });

  return { id, stored: true };
}

export interface ApplicantListFilter {
  status?: string | undefined;
  search?: string | undefined;
}

export async function listApplicants(db: D1Database, filter: ApplicantListFilter) {
  const rows = await repo.listApplicants(db, filter);
  const counts = await repo.countByStatus(db);
  return {
    applicants: rows.map(toDto),
    counts: Object.fromEntries(counts.map((row) => [row.status, row.n])),
  };
}

function toDto(row: repo.ApplicantRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    rut: row.rut,
    birthDate: row.birth_date,
    email: row.email,
    phone: row.phone,
    address: row.address,
    commune: row.commune,
    motivation: row.motivation,
    availability: row.availability,
    status: row.status,
    consentAt: row.consent_at,
    personId: row.person_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getApplicantDetail(db: D1Database, id: number) {
  const row = await repo.findApplicantById(db, id);
  if (!row) throw AppError.notFound('Postulación no encontrada.');
  const [notes, contacts] = await Promise.all([repo.listNotes(db, id), repo.listContacts(db, id)]);
  return {
    applicant: toDto(row),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      authorUserId: note.author_user_id,
      createdAt: note.created_at,
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      channel: contact.channel,
      summary: contact.summary,
      contactedAt: contact.contacted_at,
      createdBy: contact.created_by,
      createdAt: contact.created_at,
    })),
  };
}

export async function setStatus(
  db: D1Database,
  id: number,
  rawStatus: string,
  actor: Actor,
): Promise<void> {
  const status = mapStatus(rawStatus);
  const changes = await repo.updateApplicantStatus(db, id, status);
  if (changes === 0) throw AppError.notFound('Postulación no encontrada.');
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'applicants.status_changed',
    entityType: 'applicant',
    entityId: id,
    detail: { status },
    ipHash: actor.ipHash,
  });
}

export async function addNote(
  db: D1Database,
  id: number,
  body: string,
  actor: Actor,
): Promise<number> {
  const applicant = await repo.findApplicantById(db, id);
  if (!applicant) throw AppError.notFound('Postulación no encontrada.');
  const noteId = await repo.insertNote(db, id, actor.userId, body.trim());
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'applicants.note_added',
    entityType: 'applicant',
    entityId: id,
    ipHash: actor.ipHash,
  });
  return noteId;
}

export async function addContact(
  db: D1Database,
  id: number,
  input: { channel: string; summary: string; contactedAt?: string | undefined },
  actor: Actor,
): Promise<number> {
  const applicant = await repo.findApplicantById(db, id);
  if (!applicant) throw AppError.notFound('Postulación no encontrada.');
  const channel = (CONTACT_CHANNELS as readonly string[]).includes(input.channel)
    ? input.channel
    : 'otro';
  const contactedAt = input.contactedAt && input.contactedAt.trim().length > 0
    ? input.contactedAt.trim()
    : nowIso();
  const contactId = await repo.insertContact(db, {
    applicantId: id,
    channel,
    summary: input.summary.trim(),
    contactedAt,
    userId: actor.userId,
  });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'applicants.contact_logged',
    entityType: 'applicant',
    entityId: id,
    detail: { channel },
    ipHash: actor.ipHash,
  });
  return contactId;
}

export async function archiveApplicant(db: D1Database, id: number, actor: Actor): Promise<void> {
  const changes = await repo.archiveApplicant(db, id);
  if (changes === 0) throw AppError.notFound('Postulación no encontrada.');
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'applicants.archived',
    entityType: 'applicant',
    entityId: id,
    ipHash: actor.ipHash,
  });
}

/**
 * Convierte una postulación en ficha de integrante.
 *
 * Copia los datos ya conocidos y deja la ficha con la calidad «Postulante» si
 * existe en el catálogo. No copia foto: la importación de postulaciones no
 * contempla imágenes.
 */
export async function convertToPerson(
  db: D1Database,
  id: number,
  actor: Actor,
): Promise<{ personId: number }> {
  const applicant = await repo.findApplicantById(db, id);
  if (!applicant) throw AppError.notFound('Postulación no encontrada.');
  if (applicant.person_id !== null) {
    throw AppError.conflict('Esta postulación ya tiene una ficha de integrante asociada.');
  }

  const qualities = await personsRepo.listQualities(db);
  const quality = qualities.find((row) => row.name.toLowerCase() === 'postulante');

  const personId = await personsRepo.insertPerson(db, {
    fullName: applicant.full_name,
    rut: applicant.rut,
    qualityId: quality?.id ?? null,
    phone: applicant.phone,
    email: applicant.email,
    address: applicant.address,
    birthDate: applicant.birth_date,
    joinDate: null,
    registryNo: null,
    emergencyName: null,
    emergencyPhone: null,
    history: null,
    photoObjectId: null,
    isActive: false,
  });

  await repo.updateApplicantStatus(db, id, 'aceptado', personId);

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'applicants.converted',
    entityType: 'applicant',
    entityId: id,
    detail: { personId },
    ipHash: actor.ipHash,
  });

  return { personId };
}
