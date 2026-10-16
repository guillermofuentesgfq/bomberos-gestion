/**
 * Cliente HTTP tipado de la API **pública** del sitio institucional.
 *
 * Es de solo lectura y no exige CSRF ni sesión. Comparte el sobre uniforme del
 * Worker:
 *   - éxito: `{ ok: true, data: T }`
 *   - error: `{ ok: false, error: { code, message, issues? } }`
 */

import { ApiError } from './api';

export interface PublicImage {
  id: number;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface SocialLink {
  network: string;
  url: string;
}

export interface PublicInstitution {
  name: string;
  number: string;
  description: string;
  history: string;
  mission: string;
  vision: string;
  values: string;
  corpsInfo: string;
  shield: PublicImage | null;
  logo: PublicImage | null;
  cover: PublicImage | null;
  primaryColor: string;
  secondaryColor: string;
  address: string;
  region: string;
  commune: string;
  country: string;
  emergencyNumber: string;
  phones: string[];
  emails: string[];
  socials: SocialLink[];
  specialties: string[];
}

export interface PublicSeo {
  title: string;
  description: string;
  ogImage: PublicImage | null;
  siteUrl: string;
  allowIndexing: boolean;
}

export interface PublicSection {
  key: string;
  sortOrder: number;
  settings: Record<string, unknown>;
}

export interface PublicPageSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  hero: PublicImage | null;
}

export interface PublicNewsSummary {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  cover: PublicImage | null;
}

export interface PublicActivitySummary {
  slug: string;
  title: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationText: string | null;
  publishedAt: string | null;
  cover: PublicImage | null;
}

export interface PublicGallerySummary {
  slug: string;
  title: string;
  description: string | null;
  photoCount: number;
  cover: PublicImage | null;
}

export interface PublicSite {
  institution: PublicInstitution;
  seo: PublicSeo;
  sections: PublicSection[];
  pages: PublicPageSummary[];
  news: PublicNewsSummary[];
  activities: PublicActivitySummary[];
  galleries: PublicGallerySummary[];
}

export interface PublicPageDetail extends PublicPageSummary {
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface PublicNewsDetail extends PublicNewsSummary {
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface PublicActivityDetail extends PublicActivitySummary {
  body: string | null;
}

export interface PublicGalleryDetail {
  slug: string;
  title: string;
  description: string | null;
  photos: PublicImage[];
}

const BASE = '/api/v1';

interface OkEnvelope<T> {
  ok: true;
  data: T;
}

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

function isOkEnvelope(value: unknown): value is OkEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok: unknown }).ok === true &&
    'data' in value
  );
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { ok?: unknown; error?: unknown };
  if (candidate.ok !== false || typeof candidate.error !== 'object' || candidate.error === null) {
    return false;
  }
  const error = candidate.error as { code?: unknown; message?: unknown };
  return typeof error.code === 'string' && typeof error.message === 'string';
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  };
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'network_error',
      0,
      'No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.',
    );
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (isErrorEnvelope(payload)) {
    throw new ApiError(payload.error.code, response.status, payload.error.message, []);
  }
  if (!response.ok) {
    throw new ApiError('http_error', response.status, 'No se pudo cargar el contenido.');
  }
  if (!isOkEnvelope(payload)) {
    throw new ApiError('invalid_response', response.status, 'Respuesta inesperada del servidor.');
  }
  return payload.data as T;
}

/** `GET /site` — configuración, secciones y contenido publicado. */
export function fetchPublicSite(signal?: AbortSignal): Promise<PublicSite> {
  return request<PublicSite>('/site', signal);
}

/** `GET /pages/:slug`. */
export function fetchPublicPage(slug: string, signal?: AbortSignal): Promise<PublicPageDetail> {
  return request<{ page: PublicPageDetail }>(`/pages/${encodeURIComponent(slug)}`, signal).then(
    (data) => data.page,
  );
}

/** `GET /news`. */
export function fetchPublicNews(
  limit?: number,
  signal?: AbortSignal,
): Promise<PublicNewsSummary[]> {
  const query = limit !== undefined ? `?limit=${limit}` : '';
  return request<{ news: PublicNewsSummary[] }>(`/news${query}`, signal).then((data) => data.news);
}

/** `GET /news/:slug`. */
export function fetchPublicNewsItem(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicNewsDetail> {
  return request<{ news: PublicNewsDetail }>(`/news/${encodeURIComponent(slug)}`, signal).then(
    (data) => data.news,
  );
}

/** `GET /activities`. */
export function fetchPublicActivities(
  limit?: number,
  signal?: AbortSignal,
): Promise<PublicActivitySummary[]> {
  const query = limit !== undefined ? `?limit=${limit}` : '';
  return request<{ activities: PublicActivitySummary[] }>(`/activities${query}`, signal).then(
    (data) => data.activities,
  );
}

/** `GET /activities/:slug`. */
export function fetchPublicActivityItem(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicActivityDetail> {
  return request<{ activity: PublicActivityDetail }>(
    `/activities/${encodeURIComponent(slug)}`,
    signal,
  ).then((data) => data.activity);
}

/** `GET /galleries`. */
export function fetchPublicGalleries(signal?: AbortSignal): Promise<PublicGallerySummary[]> {
  return request<{ galleries: PublicGallerySummary[] }>('/galleries', signal).then(
    (data) => data.galleries,
  );
}

/** `GET /galleries/:slug`. */
export function fetchPublicGallery(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicGalleryDetail> {
  return request<{ gallery: PublicGalleryDetail }>(
    `/galleries/${encodeURIComponent(slug)}`,
    signal,
  ).then((data) => data.gallery);
}
