/**
 * Cliente del CMS para el panel administrativo.
 *
 * Todos los endpoints viven bajo `/api/v1/site`. Las escrituras requieren el
 * token CSRF de la sesión.
 */

import { ApiError } from '../lib/api';

const BASE = '/api/v1/site';

export type ContentKind = 'pages' | 'news' | 'activities' | 'galleries';
export type ContentStatus = 'draft' | 'published' | 'archived';

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

async function request<T>(
  method: string,
  path: string,
  csrfToken: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('network_error', 0, 'No se pudo contactar el servidor.');
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);

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

export interface ContentItem {
  id: number;
  slug: string;
  title: string;
  body?: string | null;
  excerpt?: string | null;
  summary?: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  createdAt?: string;
  updatedAt: string;
}

export interface InstitutionConfig {
  name: string;
  number: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  emergencyNumber: string;
}

export function fetchInstitution(csrfToken: string | null, signal?: AbortSignal): Promise<{
  institution: Record<string, unknown>;
  seo: Record<string, unknown>;
}> {
  void signal;
  return request('GET', '/institution', csrfToken);
}

export async function fetchContentList(
  kind: ContentKind,
  csrfToken: string | null,
): Promise<ContentItem[]> {
  const data = await request<Record<string, ContentItem[]>>('GET', `/${kind}`, csrfToken);
  return data[kind] ?? [];
}

export function createNews(
  input: { title: string; summary?: string | null; body?: string | null },
  csrfToken: string,
): Promise<{ id: number; slug: string }> {
  return request('POST', '/news', csrfToken, input);
}

export function transitionContent(
  kind: ContentKind,
  id: number,
  action: 'publish' | 'unpublish' | 'archive',
  csrfToken: string,
): Promise<{ status: ContentStatus }> {
  return request('POST', `/${kind}/${id}/${action}`, csrfToken);
}
