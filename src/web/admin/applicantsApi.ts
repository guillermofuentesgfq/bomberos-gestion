/**
 * Cliente del panel para el apartado de postulaciones.
 *
 * No envía correo: el contacto es interno y se registra en una bitácora. La
 * conversión a ficha de integrante exige además permiso de escritura de
 * personas, que el servidor comprueba.
 */

import { ApiError } from '../lib/api';

const BASE = '/api/v1/applicants';
const CSRF_HEADER = 'x-csrf-token';

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

async function request<T>(
  path: string,
  options: { method?: string; csrf?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method: options.method ?? 'GET', headers, credentials: 'include' };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.csrf) headers[CSRF_HEADER] = options.csrf;

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('network_error', 0, 'No se pudo contactar el servidor.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    const envelope = payload as { ok: true; data: T } | ErrorEnvelope;
    if (envelope.ok) return envelope.data;
    throw new ApiError(
      envelope.error.code,
      response.status,
      envelope.error.message,
      envelope.error.issues ?? [],
    );
  }
  throw new ApiError('invalid_response', response.status, 'El servidor devolvió una respuesta inesperada.');
}

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

export const STATUS_LABELS: Record<ApplicantStatus, string> = {
  nuevo: 'Nuevo',
  en_revision: 'En revisión',
  contactado: 'Contactado',
  entrevista: 'Entrevista',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  archivado: 'Archivado',
};

export interface Applicant {
  id: number;
  fullName: string;
  rut: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  commune: string | null;
  motivation: string | null;
  availability: string | null;
  status: ApplicantStatus;
  consentAt: string;
  personId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicantNote {
  id: number;
  body: string;
  authorUserId: number | null;
  createdAt: string;
}

export interface ApplicantContact {
  id: number;
  channel: string;
  summary: string;
  contactedAt: string;
  createdBy: number | null;
  createdAt: string;
}

export interface ApplicantDetail {
  applicant: Applicant;
  notes: ApplicantNote[];
  contacts: ApplicantContact[];
}

export function listApplicants(filter: {
  status?: string | undefined;
  q?: string | undefined;
}): Promise<{ applicants: Applicant[]; counts: Record<string, number> }> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.q) params.set('q', filter.q);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`${BASE}${suffix}`);
}

export function fetchApplicant(id: number): Promise<ApplicantDetail> {
  return request(`${BASE}/${id}`);
}

export function updateApplicantStatus(
  id: number,
  status: ApplicantStatus,
  csrfToken: string,
): Promise<{ updated: true }> {
  return request(`${BASE}/${id}/status`, { method: 'PUT', csrf: csrfToken, body: { status } });
}

export function addApplicantNote(
  id: number,
  body: string,
  csrfToken: string,
): Promise<{ id: number }> {
  return request(`${BASE}/${id}/notes`, { method: 'POST', csrf: csrfToken, body: { body } });
}

export function addApplicantContact(
  id: number,
  input: { channel: string; summary: string },
  csrfToken: string,
): Promise<{ id: number }> {
  return request(`${BASE}/${id}/contacts`, { method: 'POST', csrf: csrfToken, body: input });
}

export function convertApplicant(id: number, csrfToken: string): Promise<{ personId: number }> {
  return request(`${BASE}/${id}/convert`, { method: 'POST', csrf: csrfToken });
}

export function archiveApplicant(id: number, csrfToken: string): Promise<{ archived: true }> {
  return request(`${BASE}/${id}`, { method: 'DELETE', csrf: csrfToken });
}

export function applicantExportPath(): string {
  return `${BASE}/export.xlsx`;
}
