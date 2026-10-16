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
  signal?: AbortSignal,
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
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
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
  /** Portada de noticias y actividades (`cover_object_id`). */
  coverObjectId?: number | null;
  /** Imagen principal de páginas (`hero_object_id`). */
  heroObjectId?: number | null;
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
  signal?: AbortSignal,
): Promise<ContentItem[]> {
  const data = await request<Record<string, ContentItem[]>>(
    'GET',
    `/${kind}`,
    csrfToken,
    undefined,
    signal,
  );
  return data[kind] ?? [];
}

export function createNews(
  input: {
    title: string;
    summary?: string | null;
    body?: string | null;
    coverObjectId?: number | null;
  },
  csrfToken: string,
): Promise<{ id: number; slug: string }> {
  return request('POST', '/news', csrfToken, input);
}

export function createPage(
  input: {
    title: string;
    excerpt?: string | null;
    body?: string | null;
    heroObjectId?: number | null;
  },
  csrfToken: string,
): Promise<{ id: number; slug: string }> {
  return request('POST', '/pages', csrfToken, input);
}

export function createActivity(
  input: {
    title: string;
    summary?: string | null;
    body?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    locationText?: string | null;
    coverObjectId?: number | null;
  },
  csrfToken: string,
): Promise<{ id: number; slug: string }> {
  return request('POST', '/activities', csrfToken, input);
}

export function createGallery(
  input: { title: string; description?: string | null },
  csrfToken: string,
): Promise<{ id: number; slug: string }> {
  return request('POST', '/galleries', csrfToken, input);
}

export function transitionContent(
  kind: ContentKind,
  id: number,
  action: 'publish' | 'unpublish' | 'archive',
  csrfToken: string,
): Promise<{ status: ContentStatus }> {
  return request('POST', `/${kind}/${id}/${action}`, csrfToken);
}

// ---------------------------------------------------------------------------
// Galerías y sus fotos
// ---------------------------------------------------------------------------

/** Una foto dentro de una galería, tal como la devuelve el servidor. */
export interface GalleryPhoto {
  id: number;
  objectId: number;
  caption: string | null;
  altText: string | null;
  sortOrder: number;
  isPublic: boolean;
}

/** DTO de galería del panel (incluye estado editorial). */
export interface GallerySummary {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  status: ContentStatus;
  createdAt?: string;
  updatedAt: string;
}

export interface GalleryDetail {
  gallery: GallerySummary;
  photos: GalleryPhoto[];
}

export interface GalleryPhotoInput {
  objectId: number;
  caption?: string | null;
  altText?: string | null;
}

/** `GET /galleries/:id` — detalle de la galería con sus fotos en orden. */
export function fetchGalleryDetail(
  id: number,
  csrfToken: string | null,
  signal?: AbortSignal,
): Promise<GalleryDetail> {
  return request<GalleryDetail>('GET', `/galleries/${id}`, csrfToken, undefined, signal);
}

/** `POST /galleries/:id/photos` — agrega una o más fotos al final (201). */
export function addGalleryPhotos(
  id: number,
  photos: GalleryPhotoInput[],
  csrfToken: string,
): Promise<{ count: number }> {
  return request('POST', `/galleries/${id}/photos`, csrfToken, { photos });
}

/** `PATCH /galleries/:id/photos` — fija el orden completo a partir de los ids. */
export function reorderGalleryPhotos(
  id: number,
  order: number[],
  csrfToken: string,
): Promise<{ reordered: true }> {
  return request('PATCH', `/galleries/${id}/photos`, csrfToken, { order });
}

/** `DELETE /galleries/:id/photos/:photoId`. */
export function deleteGalleryPhoto(
  id: number,
  photoId: number,
  csrfToken: string,
): Promise<{ removed: true }> {
  return request('DELETE', `/galleries/${id}/photos/${photoId}`, csrfToken);
}

// ---------------------------------------------------------------------------
// Portadas e imágenes principales del contenido existente
// ---------------------------------------------------------------------------

/**
 * Estos `PUT` reemplazan el registro completo, así que antes de escribir se lee
 * el detalle vigente y se reenvían sus campos. Solo cambia la portada; el
 * cuerpo, el resumen y los metadatos SEO se conservan intactos.
 */

export interface NewsDetail extends ContentItem {
  coverObjectId: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function fetchNewsDetail(id: number, csrfToken: string | null): Promise<NewsDetail> {
  const data = await request<{ news: NewsDetail }>('GET', `/news/${id}`, csrfToken);
  return data.news;
}

export async function updateNewsCover(
  id: number,
  objectId: number | null,
  csrfToken: string,
): Promise<void> {
  const detail = await fetchNewsDetail(id, csrfToken);
  await request('PUT', `/news/${id}`, csrfToken, {
    title: detail.title,
    summary: detail.summary ?? null,
    body: detail.body ?? null,
    coverObjectId: objectId,
    seoTitle: detail.seoTitle ?? null,
    seoDescription: detail.seoDescription ?? null,
  });
}

export interface PageDetail extends ContentItem {
  heroObjectId: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function fetchPageDetail(id: number, csrfToken: string | null): Promise<PageDetail> {
  const data = await request<{ page: PageDetail }>('GET', `/pages/${id}`, csrfToken);
  return data.page;
}

export async function updatePageCover(
  id: number,
  objectId: number | null,
  csrfToken: string,
): Promise<void> {
  const detail = await fetchPageDetail(id, csrfToken);
  await request('PUT', `/pages/${id}`, csrfToken, {
    title: detail.title,
    body: detail.body ?? null,
    excerpt: detail.excerpt ?? null,
    heroObjectId: objectId,
    seoTitle: detail.seoTitle ?? null,
    seoDescription: detail.seoDescription ?? null,
  });
}

export interface ActivityDetail extends ContentItem {
  coverObjectId: number | null;
  startsAt: string | null;
  endsAt: string | null;
  locationText: string | null;
}

export async function fetchActivityDetail(
  id: number,
  csrfToken: string | null,
): Promise<ActivityDetail> {
  const data = await request<{ activity: ActivityDetail }>('GET', `/activities/${id}`, csrfToken);
  return data.activity;
}

export async function updateActivityCover(
  id: number,
  objectId: number | null,
  csrfToken: string,
): Promise<void> {
  const detail = await fetchActivityDetail(id, csrfToken);
  await request('PUT', `/activities/${id}`, csrfToken, {
    title: detail.title,
    summary: detail.summary ?? null,
    body: detail.body ?? null,
    startsAt: detail.startsAt ?? null,
    endsAt: detail.endsAt ?? null,
    locationText: detail.locationText ?? null,
    coverObjectId: objectId,
  });
}
