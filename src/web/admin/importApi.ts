/**
 * Cliente del panel para la importación masiva y las notificaciones.
 *
 * Comparte el contrato del resto del panel: sobre `{ ok, data }`, cookie de
 * sesión `HttpOnly` y cabecera `X-CSRF-Token` en las operaciones con estado.
 * Las descargas (plantillas e informes) se piden como `Blob` para poder mostrar
 * un error legible si la sesión caducó o falta un permiso.
 */

import { ApiError } from '../lib/api';

const BASE = '/api/v1';
const CSRF_HEADER = 'x-csrf-token';

export type ImportKind = 'material' | 'person';
export type ImportMode = 'all_or_nothing' | 'valid_only';

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

async function request<T>(path: string, options: { method?: string; csrf?: string; body?: unknown } = {}): Promise<T> {
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

/** Descarga autenticada de un archivo (plantilla o informe). */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { credentials: 'include', headers: { accept: '*/*' } });
  if (!response.ok) {
    let message = 'No se pudo descargar el archivo.';
    try {
      const payload = (await response.json()) as ErrorEnvelope;
      if (!payload.ok) message = payload.error.message;
    } catch {
      // Se conserva el mensaje genérico.
    }
    throw new ApiError('download_failed', response.status, message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// --- Importación -------------------------------------------------------------

export interface CreateBatchResult {
  id: number;
  kind: ImportKind;
  maxRows: number;
  maxChunk: number;
}

export interface IngestResult {
  stored: number;
  valid: number;
  errors: number;
  warnings: number;
  total: number;
}

export interface IssueBucket {
  code: string;
  severity: 'error' | 'warning';
  column: string;
  message: string;
  count: number;
}

export interface BatchDetail {
  batch: {
    id: number;
    kind: ImportKind;
    filename: string | null;
    status: string;
    total: number;
    valid: number;
    errors: number;
    warnings: number;
    mode: string | null;
    result: { imported?: number; skipped?: number; stockRows?: number } | null;
    createdAt: string;
    finishedAt: string | null;
  };
  issues: IssueBucket[];
}

export function createImportBatch(
  kind: ImportKind,
  filename: string,
  csrfToken: string,
): Promise<CreateBatchResult> {
  return request(`${BASE}/imports`, { method: 'POST', csrf: csrfToken, body: { kind, filename } });
}

export function sendImportRows(
  batchId: number,
  rows: { rowNo: number; values: Record<string, unknown> }[],
  csrfToken: string,
): Promise<IngestResult> {
  return request(`${BASE}/imports/${batchId}/rows`, {
    method: 'POST',
    csrf: csrfToken,
    body: { rows: rows.map((row) => ({ rowNo: row.rowNo, ...row.values })) },
  });
}

export function fetchImportBatch(batchId: number): Promise<BatchDetail> {
  return request(`${BASE}/imports/${batchId}`);
}

export function finalizeImportBatch(
  batchId: number,
  mode: ImportMode,
  csrfToken: string,
): Promise<{ imported: number; skipped: number; stockRows: number }> {
  return request(`${BASE}/imports/${batchId}/finalize`, {
    method: 'POST',
    csrf: csrfToken,
    body: { mode },
  });
}

export function importTemplatePath(kind: ImportKind, format: 'xlsx' | 'csv'): string {
  return `${BASE}/imports/templates/${kind}.${format}`;
}

export function importReportPath(batchId: number): string {
  return `${BASE}/imports/${batchId}/report.xlsx`;
}

// --- Notificaciones ----------------------------------------------------------

export interface NotificationSettings {
  enabled: boolean;
  chatId: string;
  hasToken: boolean;
  includeContact: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface NotificationLogEntry {
  id: number;
  channel: string;
  event: string;
  status: string;
  detail: string | null;
  created_at: string;
}

export interface NotificationState {
  settings: NotificationSettings;
  log: NotificationLogEntry[];
}

export function fetchNotifications(): Promise<NotificationState> {
  return request(`${BASE}/settings/notifications/telegram`);
}

export function saveTelegram(
  input: { enabled: boolean; chatId: string; includeContact: boolean; token?: string },
  csrfToken: string,
): Promise<{ settings: NotificationSettings }> {
  return request(`${BASE}/settings/notifications/telegram`, {
    method: 'PUT',
    csrf: csrfToken,
    body: input,
  });
}

export function clearTelegramToken(csrfToken: string): Promise<{ settings: NotificationSettings }> {
  return request(`${BASE}/settings/notifications/telegram/token`, {
    method: 'DELETE',
    csrf: csrfToken,
  });
}

export function testTelegram(csrfToken: string): Promise<{ ok: boolean; detail: string }> {
  return request(`${BASE}/settings/notifications/telegram/test`, {
    method: 'POST',
    csrf: csrfToken,
  });
}
