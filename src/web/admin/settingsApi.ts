/**
 * Cliente del panel para la configuración de la instalación: catálogo de
 * ubicaciones y categorías, datos institucionales de la landing y secciones
 * de la portada.
 */

import { ApiError } from '../lib/api';

const SITE = '/api/v1/site';
const INVENTORY = '/api/v1/inventory';

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

async function request<T>(
  method: string,
  url: string,
  csrfToken: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(url, {
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

// --- Tipos ------------------------------------------------------------------

export interface SocialLink {
  network: string;
  url: string;
}

export interface InstitutionConfig {
  name: string;
  number: string;
  /** Cuerpo de bomberos al que pertenece la institución. Texto plano. */
  corpsName: string;
  description: string;
  history: string;
  mission: string;
  vision: string;
  values: string;
  corpsInfo: string;
  shieldObjectId: number | null;
  logoObjectId: number | null;
  coverObjectId: number | null;
  primaryColor: string;
  secondaryColor: string;
  address: string;
  region: string;
  commune: string;
  country: string;
  timezone: string;
  emergencyNumber: string;
  phones: string[];
  emails: string[];
  socials: SocialLink[];
  specialties: string[];
}

export interface SeoConfig {
  title: string;
  description: string;
  ogImageObjectId: number | null;
  siteUrl: string;
  allowIndexing: boolean;
}

export interface SiteSection {
  key: string;
  isEnabled: boolean;
  sortOrder: number;
  settings: Record<string, unknown>;
}

export interface CatalogOption {
  id: number;
  name: string;
}

export interface InstitutionSettings {
  institution: InstitutionConfig;
  seo: SeoConfig;
}

// --- Llamadas ---------------------------------------------------------------

export function fetchInstitutionSettings(): Promise<InstitutionSettings> {
  return request<InstitutionSettings>('GET', `${SITE}/institution`, null);
}

export function updateInstitution(
  patch: Partial<InstitutionConfig>,
  csrfToken: string,
): Promise<{ updated: true }> {
  return request('PUT', `${SITE}/institution`, csrfToken, patch);
}

export function updateSeo(
  patch: Partial<SeoConfig>,
  csrfToken: string,
): Promise<{ updated: true }> {
  return request('PUT', `${SITE}/seo`, csrfToken, patch);
}

export async function fetchSections(): Promise<SiteSection[]> {
  const data = await request<{ sections: SiteSection[] }>('GET', `${SITE}/sections`, null);
  return data.sections;
}

export function updateSection(
  key: string,
  patch: { isEnabled?: boolean },
  csrfToken: string,
): Promise<{ section: SiteSection }> {
  return request('PUT', `${SITE}/sections/${encodeURIComponent(key)}`, csrfToken, patch);
}

export function reorderSections(order: string[], csrfToken: string): Promise<{ updated: true }> {
  return request('POST', `${SITE}/sections/reorder`, csrfToken, { order });
}

interface InventoryCatalog {
  locations: CatalogOption[];
  categories: CatalogOption[];
}

export function fetchCatalog(): Promise<InventoryCatalog> {
  return request<InventoryCatalog>('GET', `${INVENTORY}/catalog`, null);
}

export function createLocation(
  name: string,
  description: string | null,
  csrfToken: string,
): Promise<{ id: number }> {
  return request('POST', `${INVENTORY}/catalog/locations`, csrfToken, { name, description });
}

export function createCategory(name: string, csrfToken: string): Promise<{ id: number }> {
  return request('POST', `${INVENTORY}/catalog/categories`, csrfToken, { name });
}
