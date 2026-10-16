import { AppError } from '../lib/errors';
import { randomId, slugify } from '../lib/ids';
import { nowIso } from '../lib/time';
import { logAudit } from '../security/audit';
import type { Actor } from '../security/actor';
import * as content from '../repositories/content';
import type { ContentStatus, GalleryPhotoRow, GalleryRow, NewsRow, PageRow, ActivityRow } from '../repositories/content';

/**
 * Reglas de negocio del CMS: configuración institucional, secciones del sitio y
 * el ciclo editorial (borrador → publicado → archivado) de páginas, noticias,
 * actividades y galerías. Toda mutación relevante se audita.
 */

// ---------------------------------------------------------------------------
// Configuración institucional
// ---------------------------------------------------------------------------

export interface SocialLink {
  network: string;
  url: string;
}

export interface InstitutionConfig {
  name: string;
  number: string;
  description: string;
  history: string;
  mission: string;
  vision: string;
  values: string;
  corpsInfo: string;
  shieldObjectId: number | null;
  logoObjectId: number | null;
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

export type InstitutionConfigPatch = {
  [K in keyof InstitutionConfig]?: InstitutionConfig[K] | undefined;
};

export interface SeoConfig {
  title: string;
  description: string;
  ogImageObjectId: number | null;
  siteUrl: string;
  allowIndexing: boolean;
}

export type SeoConfigPatch = {
  [K in keyof SeoConfig]?: SeoConfig[K] | undefined;
};

const DEFAULT_INSTITUTION: InstitutionConfig = {
  name: '',
  number: '',
  description: '',
  history: '',
  mission: '',
  vision: '',
  values: '',
  corpsInfo: '',
  shieldObjectId: null,
  logoObjectId: null,
  primaryColor: '#b91c1c',
  secondaryColor: '#111827',
  address: '',
  region: '',
  commune: '',
  country: 'Chile',
  timezone: 'America/Santiago',
  emergencyNumber: '132',
  phones: [],
  emails: [],
  socials: [],
  specialties: [],
};

const DEFAULT_SEO: SeoConfig = {
  title: '',
  description: '',
  ogImageObjectId: null,
  siteUrl: '',
  allowIndexing: true,
};

function settingMap(rows: content.SettingRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.key, row.value]));
}

function readString(map: Map<string, string>, key: string, fallback: string): string {
  const value = map.get(key);
  return value === undefined ? fallback : value;
}

function readId(map: Map<string, string>, key: string): number | null {
  const value = map.get(key);
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readStringArray(map: Map<string, string>, key: string): string[] {
  const raw = map.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function readSocials(map: Map<string, string>, key: string): SocialLink[] {
  const raw = map.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const candidate = item as { network?: unknown; url?: unknown };
      if (typeof candidate.network !== 'string' || typeof candidate.url !== 'string') return [];
      return [{ network: candidate.network, url: candidate.url }];
    });
  } catch {
    return [];
  }
}

export async function getInstitutionConfig(db: D1Database): Promise<InstitutionConfig> {
  const map = settingMap(await content.listSettings(db, 'institution_settings'));
  return {
    name: readString(map, 'name', DEFAULT_INSTITUTION.name),
    number: readString(map, 'number', DEFAULT_INSTITUTION.number),
    description: readString(map, 'description', DEFAULT_INSTITUTION.description),
    history: readString(map, 'history', DEFAULT_INSTITUTION.history),
    mission: readString(map, 'mission', DEFAULT_INSTITUTION.mission),
    vision: readString(map, 'vision', DEFAULT_INSTITUTION.vision),
    values: readString(map, 'values', DEFAULT_INSTITUTION.values),
    corpsInfo: readString(map, 'corpsInfo', DEFAULT_INSTITUTION.corpsInfo),
    shieldObjectId: readId(map, 'shieldObjectId'),
    logoObjectId: readId(map, 'logoObjectId'),
    primaryColor: readString(map, 'primaryColor', DEFAULT_INSTITUTION.primaryColor),
    secondaryColor: readString(map, 'secondaryColor', DEFAULT_INSTITUTION.secondaryColor),
    address: readString(map, 'address', DEFAULT_INSTITUTION.address),
    region: readString(map, 'region', DEFAULT_INSTITUTION.region),
    commune: readString(map, 'commune', DEFAULT_INSTITUTION.commune),
    country: readString(map, 'country', DEFAULT_INSTITUTION.country),
    timezone: readString(map, 'timezone', DEFAULT_INSTITUTION.timezone),
    emergencyNumber: readString(map, 'emergencyNumber', DEFAULT_INSTITUTION.emergencyNumber),
    phones: readStringArray(map, 'phones'),
    emails: readStringArray(map, 'emails'),
    socials: readSocials(map, 'socials'),
    specialties: readStringArray(map, 'specialties'),
  };
}

export async function getSeoConfig(db: D1Database): Promise<SeoConfig> {
  const map = settingMap(await content.listSettings(db, 'seo_settings'));
  const indexing = map.get('allowIndexing');
  return {
    title: readString(map, 'title', DEFAULT_SEO.title),
    description: readString(map, 'description', DEFAULT_SEO.description),
    ogImageObjectId: readId(map, 'ogImageObjectId'),
    siteUrl: readString(map, 'siteUrl', DEFAULT_SEO.siteUrl),
    allowIndexing: indexing === undefined ? DEFAULT_SEO.allowIndexing : indexing === 'true',
  };
}

interface SettingEntry {
  key: string;
  value: string;
}

function pushString(entries: SettingEntry[], key: string, value: string | undefined): void {
  if (value !== undefined) entries.push({ key, value });
}

function pushJson(entries: SettingEntry[], key: string, value: unknown): void {
  if (value !== undefined) entries.push({ key, value: JSON.stringify(value) });
}

function pushId(entries: SettingEntry[], key: string, value: number | null | undefined): void {
  if (value !== undefined) entries.push({ key, value: value === null ? '' : String(value) });
}

export async function updateInstitutionConfig(
  db: D1Database,
  patch: InstitutionConfigPatch,
  actor: Actor,
): Promise<void> {
  const entries: SettingEntry[] = [];
  pushString(entries, 'name', patch.name);
  pushString(entries, 'number', patch.number);
  pushString(entries, 'description', patch.description);
  pushString(entries, 'history', patch.history);
  pushString(entries, 'mission', patch.mission);
  pushString(entries, 'vision', patch.vision);
  pushString(entries, 'values', patch.values);
  pushString(entries, 'corpsInfo', patch.corpsInfo);
  pushId(entries, 'shieldObjectId', patch.shieldObjectId);
  pushId(entries, 'logoObjectId', patch.logoObjectId);
  pushString(entries, 'primaryColor', patch.primaryColor);
  pushString(entries, 'secondaryColor', patch.secondaryColor);
  pushString(entries, 'address', patch.address);
  pushString(entries, 'region', patch.region);
  pushString(entries, 'commune', patch.commune);
  pushString(entries, 'country', patch.country);
  pushString(entries, 'timezone', patch.timezone);
  pushString(entries, 'emergencyNumber', patch.emergencyNumber);
  pushJson(entries, 'phones', patch.phones);
  pushJson(entries, 'emails', patch.emails);
  pushJson(entries, 'socials', patch.socials);
  pushJson(entries, 'specialties', patch.specialties);

  if (entries.length === 0) return;
  await content.upsertSettings(db, 'institution_settings', entries);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.institution_updated',
    entityType: 'institution_settings',
    detail: { keys: entries.map((entry) => entry.key) },
    ipHash: actor.ipHash,
  });
}

export async function updateSeoConfig(
  db: D1Database,
  patch: SeoConfigPatch,
  actor: Actor,
): Promise<void> {
  const entries: SettingEntry[] = [];
  pushString(entries, 'title', patch.title);
  pushString(entries, 'description', patch.description);
  pushId(entries, 'ogImageObjectId', patch.ogImageObjectId);
  pushString(entries, 'siteUrl', patch.siteUrl);
  if (patch.allowIndexing !== undefined) {
    entries.push({ key: 'allowIndexing', value: patch.allowIndexing ? 'true' : 'false' });
  }

  if (entries.length === 0) return;
  await content.upsertSettings(db, 'seo_settings', entries);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.seo_updated',
    entityType: 'seo_settings',
    detail: { keys: entries.map((entry) => entry.key) },
    ipHash: actor.ipHash,
  });
}

// ---------------------------------------------------------------------------
// Secciones del sitio
// ---------------------------------------------------------------------------

export interface SiteSection {
  key: string;
  isEnabled: boolean;
  sortOrder: number;
  settings: Record<string, unknown>;
}

function parseSectionSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function listSiteSections(db: D1Database): Promise<SiteSection[]> {
  const rows = await content.listSections(db);
  return rows.map((row) => ({
    key: row.section_key,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    settings: parseSectionSettings(row.settings),
  }));
}

export interface SiteSectionPatch {
  isEnabled?: boolean | undefined;
  settings?: Record<string, unknown> | undefined;
}

export async function updateSiteSection(
  db: D1Database,
  key: string,
  patch: SiteSectionPatch,
  actor: Actor,
): Promise<SiteSection> {
  const existing = await content.findSectionByKey(db, key);
  if (!existing) throw AppError.notFound('Sección no encontrada.');

  const isEnabled = patch.isEnabled ?? existing.is_enabled === 1;
  const currentSettings = parseSectionSettings(existing.settings);
  const settings = patch.settings ?? currentSettings;

  await content.updateSection(db, key, {
    isEnabled,
    settings: JSON.stringify(settings),
  });

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.section_updated',
    entityType: 'site_section',
    entityId: key,
    detail: { isEnabled },
    ipHash: actor.ipHash,
  });

  return { key, isEnabled, sortOrder: existing.sort_order, settings };
}

export async function reorderSiteSections(
  db: D1Database,
  order: string[],
  actor: Actor,
): Promise<void> {
  const existing = await content.listSections(db);
  const known = new Set(existing.map((row) => row.section_key));
  for (const key of order) {
    if (!known.has(key)) throw AppError.unprocessable(`Sección desconocida: ${key}.`);
  }
  await content.reorderSections(db, order);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.sections_reordered',
    entityType: 'site_section',
    detail: { order },
    ipHash: actor.ipHash,
  });
}

// ---------------------------------------------------------------------------
// Contenido editorial
// ---------------------------------------------------------------------------

export type ContentKind = 'page' | 'news' | 'activity' | 'gallery';

const CONTENT_META: Record<ContentKind, { table: content.ContentTable; entityType: string; label: string }> = {
  page: { table: 'pages', entityType: 'page', label: 'página' },
  news: { table: 'news', entityType: 'news', label: 'noticia' },
  activity: { table: 'activities', entityType: 'activity', label: 'actividad' },
  gallery: { table: 'galleries', entityType: 'gallery', label: 'galería' },
};

type SlugExists = (db: D1Database, slug: string) => Promise<boolean>;

const SLUG_EXISTS: Record<ContentKind, SlugExists> = {
  page: content.pageSlugExists,
  news: content.newsSlugExists,
  activity: content.activitySlugExists,
  gallery: content.gallerySlugExists,
};

/** Genera un slug único a partir de un texto, o respeta el solicitado. */
async function resolveSlug(
  db: D1Database,
  kind: ContentKind,
  requested: string | undefined,
  title: string,
): Promise<string> {
  const exists = SLUG_EXISTS[kind];
  if (requested !== undefined) {
    const normalized = slugify(requested);
    if (!normalized) throw AppError.unprocessable('El identificador de URL no es válido.');
    if (await exists(db, normalized)) {
      throw AppError.conflict('Ya existe un contenido con ese identificador de URL.');
    }
    return normalized;
  }
  const base = slugify(title) || 'contenido';
  if (!(await exists(db, base))) return base;
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(db, candidate))) return candidate;
  }
  return `${base}-${randomId(4)}`;
}

// --- Páginas ---------------------------------------------------------------

export interface PageInput {
  slug?: string | undefined;
  title: string;
  body?: string | null | undefined;
  excerpt?: string | null | undefined;
  heroObjectId?: number | null | undefined;
  seoTitle?: string | null | undefined;
  seoDescription?: string | null | undefined;
}

export async function createPage(
  db: D1Database,
  input: PageInput,
  actor: Actor,
): Promise<{ id: number; slug: string }> {
  const slug = await resolveSlug(db, 'page', input.slug, input.title);
  const id = await content.insertPage(db, {
    slug,
    title: input.title,
    body: input.body ?? null,
    excerpt: input.excerpt ?? null,
    heroObjectId: input.heroObjectId ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    createdBy: actor.userId,
  });
  await auditCreate(db, 'page', id, slug, actor);
  return { id, slug };
}

export async function updatePage(
  db: D1Database,
  id: number,
  input: PageInput,
  actor: Actor,
): Promise<void> {
  await requireContent(db, 'page', id);
  await content.updatePage(db, id, {
    title: input.title,
    body: input.body ?? null,
    excerpt: input.excerpt ?? null,
    heroObjectId: input.heroObjectId ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
  });
  await auditUpdate(db, 'page', id, actor);
}

// --- Noticias --------------------------------------------------------------

export interface NewsInput {
  slug?: string | undefined;
  title: string;
  summary?: string | null | undefined;
  body?: string | null | undefined;
  coverObjectId?: number | null | undefined;
  seoTitle?: string | null | undefined;
  seoDescription?: string | null | undefined;
}

export async function createNews(
  db: D1Database,
  input: NewsInput,
  actor: Actor,
): Promise<{ id: number; slug: string }> {
  const slug = await resolveSlug(db, 'news', input.slug, input.title);
  const id = await content.insertNews(db, {
    slug,
    title: input.title,
    summary: input.summary ?? null,
    body: input.body ?? null,
    coverObjectId: input.coverObjectId ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    createdBy: actor.userId,
  });
  await auditCreate(db, 'news', id, slug, actor);
  return { id, slug };
}

export async function updateNews(
  db: D1Database,
  id: number,
  input: NewsInput,
  actor: Actor,
): Promise<void> {
  await requireContent(db, 'news', id);
  await content.updateNews(db, id, {
    title: input.title,
    summary: input.summary ?? null,
    body: input.body ?? null,
    coverObjectId: input.coverObjectId ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
  });
  await auditUpdate(db, 'news', id, actor);
}

// --- Actividades -----------------------------------------------------------

export interface ActivityInput {
  slug?: string | undefined;
  title: string;
  summary?: string | null | undefined;
  body?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  locationText?: string | null | undefined;
  coverObjectId?: number | null | undefined;
}

export async function createActivity(
  db: D1Database,
  input: ActivityInput,
  actor: Actor,
): Promise<{ id: number; slug: string }> {
  const slug = await resolveSlug(db, 'activity', input.slug, input.title);
  const id = await content.insertActivity(db, {
    slug,
    title: input.title,
    summary: input.summary ?? null,
    body: input.body ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    locationText: input.locationText ?? null,
    coverObjectId: input.coverObjectId ?? null,
    createdBy: actor.userId,
  });
  await auditCreate(db, 'activity', id, slug, actor);
  return { id, slug };
}

export async function updateActivity(
  db: D1Database,
  id: number,
  input: ActivityInput,
  actor: Actor,
): Promise<void> {
  await requireContent(db, 'activity', id);
  await content.updateActivity(db, id, {
    title: input.title,
    summary: input.summary ?? null,
    body: input.body ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    locationText: input.locationText ?? null,
    coverObjectId: input.coverObjectId ?? null,
  });
  await auditUpdate(db, 'activity', id, actor);
}

// --- Galerías --------------------------------------------------------------

export interface GalleryInput {
  slug?: string | undefined;
  title: string;
  description?: string | null | undefined;
}

export async function createGallery(
  db: D1Database,
  input: GalleryInput,
  actor: Actor,
): Promise<{ id: number; slug: string }> {
  const slug = await resolveSlug(db, 'gallery', input.slug, input.title);
  const id = await content.insertGallery(db, {
    slug,
    title: input.title,
    description: input.description ?? null,
  });
  await auditCreate(db, 'gallery', id, slug, actor);
  return { id, slug };
}

export async function updateGallery(
  db: D1Database,
  id: number,
  input: GalleryInput,
  actor: Actor,
): Promise<void> {
  await requireContent(db, 'gallery', id);
  await content.updateGallery(db, id, {
    title: input.title,
    description: input.description ?? null,
  });
  await auditUpdate(db, 'gallery', id, actor);
}

// ---------------------------------------------------------------------------
// Ciclo editorial
// ---------------------------------------------------------------------------

export type PublishAction = 'publish' | 'unpublish' | 'archive';

const ACTION_STATUS: Record<PublishAction, ContentStatus> = {
  publish: 'published',
  unpublish: 'draft',
  archive: 'archived',
};

const ACTION_AUDIT: Record<PublishAction, string> = {
  publish: 'published',
  unpublish: 'unpublished',
  archive: 'archived',
};

export async function transitionContent(
  db: D1Database,
  kind: ContentKind,
  id: number,
  action: PublishAction,
  actor: Actor,
): Promise<{ status: ContentStatus }> {
  const meta = CONTENT_META[kind];
  const status = ACTION_STATUS[action];
  const publishedAt = action === 'publish' ? nowIso() : undefined;
  const changes = await content.setContentStatus(db, meta.table, id, status, publishedAt);
  if (changes === 0) throw AppError.notFound(`No se encontró la ${meta.label}.`);

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: `site.${meta.entityType}_${ACTION_AUDIT[action]}`,
    entityType: meta.entityType,
    entityId: id,
    detail: { status },
    ipHash: actor.ipHash,
  });
  return { status };
}

async function requireContent(
  db: D1Database,
  kind: ContentKind,
  id: number,
): Promise<string> {
  const slug = await content.findContentSlug(db, CONTENT_META[kind].table, id);
  if (slug === null) throw AppError.notFound(`No se encontró la ${CONTENT_META[kind].label}.`);
  return slug;
}

async function auditCreate(
  db: D1Database,
  kind: ContentKind,
  id: number,
  slug: string,
  actor: Actor,
): Promise<void> {
  const meta = CONTENT_META[kind];
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: `site.${meta.entityType}_created`,
    entityType: meta.entityType,
    entityId: id,
    detail: { slug },
    ipHash: actor.ipHash,
  });
}

async function auditUpdate(
  db: D1Database,
  kind: ContentKind,
  id: number,
  actor: Actor,
): Promise<void> {
  const meta = CONTENT_META[kind];
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: `site.${meta.entityType}_updated`,
    entityType: meta.entityType,
    entityId: id,
    ipHash: actor.ipHash,
  });
}

// ---------------------------------------------------------------------------
// Fotos de galería
// ---------------------------------------------------------------------------

export interface GalleryPhotoInput {
  objectId: number;
  caption?: string | null | undefined;
  altText?: string | null | undefined;
}

type ExistingPhoto = Pick<GalleryPhotoRow, 'object_id' | 'caption' | 'alt_text'>;

function toNewPhoto(photo: GalleryPhotoInput): content.NewGalleryPhoto {
  return {
    objectId: photo.objectId,
    caption: photo.caption ?? null,
    altText: photo.altText ?? null,
  };
}

function fromExisting(photo: ExistingPhoto): content.NewGalleryPhoto {
  return { objectId: photo.object_id, caption: photo.caption, altText: photo.alt_text };
}

/** Reemplaza por completo el conjunto de fotos de una galería, en orden. */
export async function setGalleryPhotos(
  db: D1Database,
  galleryId: number,
  photos: GalleryPhotoInput[],
  actor: Actor,
): Promise<{ count: number }> {
  await requireGallery(db, galleryId);
  const count = await content.replaceGalleryPhotos(db, galleryId, photos.map(toNewPhoto));
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.gallery_photos_set',
    entityType: 'gallery',
    entityId: galleryId,
    detail: { count },
    ipHash: actor.ipHash,
  });
  return { count };
}

/** Agrega fotos al final de una galería. */
export async function addGalleryPhotos(
  db: D1Database,
  galleryId: number,
  photos: GalleryPhotoInput[],
  actor: Actor,
): Promise<{ count: number }> {
  await requireGallery(db, galleryId);
  const existing = await content.listGalleryPhotos(db, galleryId);
  const combined = [...existing.map(fromExisting), ...photos.map(toNewPhoto)];
  const count = await content.replaceGalleryPhotos(db, galleryId, combined);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.gallery_photos_added',
    entityType: 'gallery',
    entityId: galleryId,
    detail: { added: photos.length, total: count },
    ipHash: actor.ipHash,
  });
  return { count };
}

/** Reordena las fotos según la lista de identificadores dada. */
export async function reorderGalleryPhotos(
  db: D1Database,
  galleryId: number,
  photoIds: number[],
  actor: Actor,
): Promise<void> {
  await requireGallery(db, galleryId);
  const existing = await content.listGalleryPhotos(db, galleryId);
  const byId = new Map(existing.map((photo) => [photo.id, photo]));
  const ordered: content.NewGalleryPhoto[] = [];
  for (const photoId of photoIds) {
    const photo = byId.get(photoId);
    if (!photo) throw AppError.unprocessable(`La foto ${photoId} no pertenece a la galería.`);
    ordered.push(fromExisting(photo));
    byId.delete(photoId);
  }
  for (const photo of byId.values()) ordered.push(fromExisting(photo));
  await content.replaceGalleryPhotos(db, galleryId, ordered);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.gallery_photos_reordered',
    entityType: 'gallery',
    entityId: galleryId,
    detail: { count: ordered.length },
    ipHash: actor.ipHash,
  });
}

export async function removeGalleryPhoto(
  db: D1Database,
  galleryId: number,
  photoId: number,
  actor: Actor,
): Promise<void> {
  await requireGallery(db, galleryId);
  const changes = await content.deleteGalleryPhoto(db, galleryId, photoId);
  if (changes === 0) throw AppError.notFound('Foto no encontrada.');
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'site.gallery_photo_removed',
    entityType: 'gallery',
    entityId: galleryId,
    detail: { photoId },
    ipHash: actor.ipHash,
  });
}

async function requireGallery(db: D1Database, galleryId: number): Promise<GalleryRow> {
  const gallery = await content.findGalleryById(db, galleryId);
  if (!gallery) throw AppError.notFound('Galería no encontrada.');
  return gallery;
}

// Reexportado para las rutas admin (evita importar dos módulos).
export type { GalleryRow, NewsRow, PageRow, ActivityRow, GalleryPhotoRow };
