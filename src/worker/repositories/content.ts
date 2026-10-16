import { all, batch, changedRows, first, run, stmt } from '../lib/db';
import { nowIso } from '../lib/time';

/**
 * Acceso a D1 del CMS y la configuración institucional.
 *
 * Reglas del proyecto: SQL siempre parametrizado, sin `SELECT *` y con los
 * nombres de tabla tomados de uniones cerradas (nunca de la entrada del
 * cliente), de modo que interpolar la tabla en una sentencia es seguro.
 */

/** Estado editorial de un contenido. */
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Tablas con columna `status` compartida. */
export const CONTENT_TABLES = ['pages', 'news', 'activities', 'galleries'] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

// ---------------------------------------------------------------------------
// Configuración par clave/valor
// ---------------------------------------------------------------------------

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Tablas de configuración clave/valor admitidas. */
export const SETTINGS_TABLES = ['institution_settings', 'seo_settings'] as const;
export type SettingsTable = (typeof SETTINGS_TABLES)[number];

const SETTINGS_TABLE_SQL: Record<SettingsTable, string> = {
  institution_settings: 'institution_settings',
  seo_settings: 'seo_settings',
};

export async function listSettings(
  db: D1Database,
  table: SettingsTable,
): Promise<SettingRow[]> {
  return all<SettingRow>(
    db,
    `SELECT key, value, updated_at FROM ${SETTINGS_TABLE_SQL[table]} ORDER BY key`,
  );
}

/** Inserta o actualiza un conjunto de claves en una sola transacción. */
export async function upsertSettings(
  db: D1Database,
  table: SettingsTable,
  entries: { key: string; value: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  const now = nowIso();
  const target = SETTINGS_TABLE_SQL[table];
  await batch(
    db,
    entries.map((entry) =>
      stmt(
        db,
        `INSERT INTO ${target} (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        entry.key,
        entry.value,
        now,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Secciones del sitio
// ---------------------------------------------------------------------------

export interface SectionRow {
  id: number;
  section_key: string;
  is_enabled: number;
  sort_order: number;
  settings: string | null;
}

const SECTION_COLUMNS = 'id, section_key, is_enabled, sort_order, settings';

export async function listSections(db: D1Database): Promise<SectionRow[]> {
  return all<SectionRow>(
    db,
    `SELECT ${SECTION_COLUMNS} FROM site_sections ORDER BY sort_order, section_key`,
  );
}

export async function findSectionByKey(
  db: D1Database,
  key: string,
): Promise<SectionRow | null> {
  return first<SectionRow>(
    db,
    `SELECT ${SECTION_COLUMNS} FROM site_sections WHERE section_key = ?`,
    key,
  );
}

export async function updateSection(
  db: D1Database,
  key: string,
  values: { isEnabled: boolean; settings: string | null },
): Promise<number> {
  return changedRows(
    db,
    `UPDATE site_sections SET is_enabled = ?, settings = ? WHERE section_key = ?`,
    values.isEnabled ? 1 : 0,
    values.settings,
    key,
  );
}

/** Reordena las secciones según la lista de claves dada (por índice). */
export async function reorderSections(
  db: D1Database,
  order: string[],
): Promise<void> {
  if (order.length === 0) return;
  await batch(
    db,
    order.map((key, index) =>
      stmt(db, `UPDATE site_sections SET sort_order = ? WHERE section_key = ?`, index + 1, key),
    ),
  );
}

// ---------------------------------------------------------------------------
// Objetos de almacenamiento (resumen para el sitio público)
// ---------------------------------------------------------------------------

export interface ObjectSummaryRow {
  id: number;
  content_type: string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  is_public: number;
}

/** Resúmenes de objetos por id; ignora ids no válidos o archivados. */
export async function listObjectSummaries(
  db: D1Database,
  ids: (number | null | undefined)[],
): Promise<ObjectSummaryRow[]> {
  const unique = [...new Set(ids)].filter(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0,
  );
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(', ');
  return all<ObjectSummaryRow>(
    db,
    `SELECT id, content_type, width, height, alt_text, caption, is_public
       FROM storage_objects
      WHERE archived_at IS NULL AND id IN (${placeholders})`,
    ...unique,
  );
}

// ---------------------------------------------------------------------------
// Contenido editorial (páginas, noticias, actividades, galerías)
// ---------------------------------------------------------------------------

export interface PageRow {
  id: number;
  slug: string;
  title: string;
  body: string | null;
  excerpt: string | null;
  hero_object_id: number | null;
  status: ContentStatus;
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
}

export interface NewsRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  cover_object_id: number | null;
  status: ContentStatus;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
}

export interface ActivityRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location_text: string | null;
  cover_object_id: number | null;
  status: ContentStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
}

export interface GalleryRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  status: ContentStatus;
  created_at: string;
  updated_at: string;
}

export interface GalleryPhotoRow {
  id: number;
  gallery_id: number;
  object_id: number;
  caption: string | null;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
  width: number | null;
  height: number | null;
  is_public: number;
}

const PAGE_COLUMNS = `id, slug, title, body, excerpt, hero_object_id, status,
  seo_title, seo_description, published_at, created_at, updated_at, created_by`;
const NEWS_COLUMNS = `id, slug, title, summary, body, cover_object_id, status,
  published_at, seo_title, seo_description, created_at, updated_at, created_by`;
const ACTIVITY_COLUMNS = `id, slug, title, summary, body, starts_at, ends_at, location_text,
  cover_object_id, status, published_at, created_at, updated_at, created_by`;
const GALLERY_COLUMNS = `id, slug, title, description, status, created_at, updated_at`;

// --- Páginas ---------------------------------------------------------------

export async function listPages(db: D1Database): Promise<PageRow[]> {
  return all<PageRow>(
    db,
    `SELECT ${PAGE_COLUMNS} FROM pages ORDER BY status, published_at DESC, title`,
  );
}

export async function listPublishedPages(db: D1Database): Promise<PageRow[]> {
  return all<PageRow>(
    db,
    `SELECT ${PAGE_COLUMNS} FROM pages
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC, title`,
  );
}

export async function findPageById(db: D1Database, id: number): Promise<PageRow | null> {
  return first<PageRow>(db, `SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`, id);
}

export async function findPublishedPageBySlug(
  db: D1Database,
  slug: string,
): Promise<PageRow | null> {
  return first<PageRow>(
    db,
    `SELECT ${PAGE_COLUMNS} FROM pages
      WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL`,
    slug,
  );
}

export async function pageSlugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await first<{ id: number }>(db, `SELECT id FROM pages WHERE slug = ?`, slug);
  return row !== null;
}

export interface NewPage {
  slug: string;
  title: string;
  body: string | null;
  excerpt: string | null;
  heroObjectId: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdBy: number | null;
}

export async function insertPage(db: D1Database, page: NewPage): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO pages
       (slug, title, body, excerpt, hero_object_id, status, seo_title, seo_description,
        created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    page.slug,
    page.title,
    page.body,
    page.excerpt,
    page.heroObjectId,
    page.seoTitle,
    page.seoDescription,
    now,
    now,
    page.createdBy,
  );
  return Number(result.meta.last_row_id);
}

export interface PageUpdate {
  title: string;
  body: string | null;
  excerpt: string | null;
  heroObjectId: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export async function updatePage(
  db: D1Database,
  id: number,
  page: PageUpdate,
): Promise<void> {
  await run(
    db,
    `UPDATE pages
        SET title = ?, body = ?, excerpt = ?, hero_object_id = ?,
            seo_title = ?, seo_description = ?, updated_at = ?
      WHERE id = ?`,
    page.title,
    page.body,
    page.excerpt,
    page.heroObjectId,
    page.seoTitle,
    page.seoDescription,
    nowIso(),
    id,
  );
}

// --- Noticias --------------------------------------------------------------

export async function listNews(db: D1Database): Promise<NewsRow[]> {
  return all<NewsRow>(
    db,
    `SELECT ${NEWS_COLUMNS} FROM news ORDER BY status, published_at DESC, created_at DESC`,
  );
}

export async function listPublishedNews(db: D1Database, limit: number): Promise<NewsRow[]> {
  return all<NewsRow>(
    db,
    `SELECT ${NEWS_COLUMNS} FROM news
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?`,
    limit,
  );
}

export async function findNewsById(db: D1Database, id: number): Promise<NewsRow | null> {
  return first<NewsRow>(db, `SELECT ${NEWS_COLUMNS} FROM news WHERE id = ?`, id);
}

export async function findPublishedNewsBySlug(
  db: D1Database,
  slug: string,
): Promise<NewsRow | null> {
  return first<NewsRow>(
    db,
    `SELECT ${NEWS_COLUMNS} FROM news
      WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL`,
    slug,
  );
}

export async function newsSlugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await first<{ id: number }>(db, `SELECT id FROM news WHERE slug = ?`, slug);
  return row !== null;
}

export interface NewNews {
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  coverObjectId: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdBy: number | null;
}

export async function insertNews(db: D1Database, item: NewNews): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO news
       (slug, title, summary, body, cover_object_id, status, seo_title, seo_description,
        created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    item.slug,
    item.title,
    item.summary,
    item.body,
    item.coverObjectId,
    item.seoTitle,
    item.seoDescription,
    now,
    now,
    item.createdBy,
  );
  return Number(result.meta.last_row_id);
}

export interface NewsUpdate {
  title: string;
  summary: string | null;
  body: string | null;
  coverObjectId: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export async function updateNews(db: D1Database, id: number, item: NewsUpdate): Promise<void> {
  await run(
    db,
    `UPDATE news
        SET title = ?, summary = ?, body = ?, cover_object_id = ?,
            seo_title = ?, seo_description = ?, updated_at = ?
      WHERE id = ?`,
    item.title,
    item.summary,
    item.body,
    item.coverObjectId,
    item.seoTitle,
    item.seoDescription,
    nowIso(),
    id,
  );
}

// --- Actividades -----------------------------------------------------------

export async function listActivities(db: D1Database): Promise<ActivityRow[]> {
  return all<ActivityRow>(
    db,
    `SELECT ${ACTIVITY_COLUMNS} FROM activities ORDER BY status, starts_at DESC, created_at DESC`,
  );
}

export async function listPublishedActivities(
  db: D1Database,
  limit: number,
): Promise<ActivityRow[]> {
  return all<ActivityRow>(
    db,
    `SELECT ${ACTIVITY_COLUMNS} FROM activities
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY COALESCE(starts_at, published_at) DESC
      LIMIT ?`,
    limit,
  );
}

export async function findActivityById(
  db: D1Database,
  id: number,
): Promise<ActivityRow | null> {
  return first<ActivityRow>(db, `SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE id = ?`, id);
}

export async function findPublishedActivityBySlug(
  db: D1Database,
  slug: string,
): Promise<ActivityRow | null> {
  return first<ActivityRow>(
    db,
    `SELECT ${ACTIVITY_COLUMNS} FROM activities
      WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL`,
    slug,
  );
}

export async function activitySlugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await first<{ id: number }>(db, `SELECT id FROM activities WHERE slug = ?`, slug);
  return row !== null;
}

export interface NewActivity {
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationText: string | null;
  coverObjectId: number | null;
  createdBy: number | null;
}

export async function insertActivity(db: D1Database, item: NewActivity): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO activities
       (slug, title, summary, body, starts_at, ends_at, location_text, cover_object_id,
        status, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    item.slug,
    item.title,
    item.summary,
    item.body,
    item.startsAt,
    item.endsAt,
    item.locationText,
    item.coverObjectId,
    now,
    now,
    item.createdBy,
  );
  return Number(result.meta.last_row_id);
}

export interface ActivityUpdate {
  title: string;
  summary: string | null;
  body: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationText: string | null;
  coverObjectId: number | null;
}

export async function updateActivity(
  db: D1Database,
  id: number,
  item: ActivityUpdate,
): Promise<void> {
  await run(
    db,
    `UPDATE activities
        SET title = ?, summary = ?, body = ?, starts_at = ?, ends_at = ?,
            location_text = ?, cover_object_id = ?, updated_at = ?
      WHERE id = ?`,
    item.title,
    item.summary,
    item.body,
    item.startsAt,
    item.endsAt,
    item.locationText,
    item.coverObjectId,
    nowIso(),
    id,
  );
}

// --- Galerías --------------------------------------------------------------

export async function listGalleries(db: D1Database): Promise<GalleryRow[]> {
  return all<GalleryRow>(
    db,
    `SELECT ${GALLERY_COLUMNS} FROM galleries ORDER BY status, created_at DESC`,
  );
}

export async function listPublishedGalleries(db: D1Database): Promise<GalleryRow[]> {
  return all<GalleryRow>(
    db,
    `SELECT ${GALLERY_COLUMNS} FROM galleries
      WHERE status = 'published'
      ORDER BY created_at DESC`,
  );
}

export async function findGalleryById(db: D1Database, id: number): Promise<GalleryRow | null> {
  return first<GalleryRow>(db, `SELECT ${GALLERY_COLUMNS} FROM galleries WHERE id = ?`, id);
}

export async function findPublishedGalleryBySlug(
  db: D1Database,
  slug: string,
): Promise<GalleryRow | null> {
  return first<GalleryRow>(
    db,
    `SELECT ${GALLERY_COLUMNS} FROM galleries WHERE slug = ? AND status = 'published'`,
    slug,
  );
}

export async function gallerySlugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await first<{ id: number }>(db, `SELECT id FROM galleries WHERE slug = ?`, slug);
  return row !== null;
}

export async function insertGallery(
  db: D1Database,
  gallery: { slug: string; title: string; description: string | null },
): Promise<number> {
  const now = nowIso();
  const result = await run(
    db,
    `INSERT INTO galleries (slug, title, description, status, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?)`,
    gallery.slug,
    gallery.title,
    gallery.description,
    now,
    now,
  );
  return Number(result.meta.last_row_id);
}

export async function updateGallery(
  db: D1Database,
  id: number,
  gallery: { title: string; description: string | null },
): Promise<void> {
  await run(
    db,
    `UPDATE galleries SET title = ?, description = ?, updated_at = ? WHERE id = ?`,
    gallery.title,
    gallery.description,
    nowIso(),
    id,
  );
}

// --- Cambios de estado -----------------------------------------------------

const STATUS_UPDATE_SQL: Record<ContentTable, string> = {
  pages: `UPDATE pages SET status = ?, updated_at = ? WHERE id = ?`,
  news: `UPDATE news SET status = ?, updated_at = ? WHERE id = ?`,
  activities: `UPDATE activities SET status = ?, updated_at = ? WHERE id = ?`,
  galleries: `UPDATE galleries SET status = ?, updated_at = ? WHERE id = ?`,
};

const PUBLISH_UPDATE_SQL: Record<Exclude<ContentTable, 'galleries'>, string> = {
  pages: `UPDATE pages SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`,
  news: `UPDATE news SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`,
  activities: `UPDATE activities SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`,
};

/**
 * Cambia el estado de un contenido. `publishedAt` solo aplica a tablas con esa
 * columna (no a galerías).
 */
export async function setContentStatus(
  db: D1Database,
  table: ContentTable,
  id: number,
  status: ContentStatus,
  publishedAt?: string,
): Promise<number> {
  const now = nowIso();
  if (publishedAt !== undefined && table !== 'galleries') {
    return changedRows(db, PUBLISH_UPDATE_SQL[table], publishedAt, now, id);
  }
  return changedRows(db, STATUS_UPDATE_SQL[table], status, now, id);
}

/** Comprueba que existe el contenido indicado y devuelve su slug. */
export async function findContentSlug(
  db: D1Database,
  table: ContentTable,
  id: number,
): Promise<string | null> {
  const sql: Record<ContentTable, string> = {
    pages: `SELECT slug FROM pages WHERE id = ?`,
    news: `SELECT slug FROM news WHERE id = ?`,
    activities: `SELECT slug FROM activities WHERE id = ?`,
    galleries: `SELECT slug FROM galleries WHERE id = ?`,
  };
  const row = await first<{ slug: string }>(db, sql[table], id);
  return row?.slug ?? null;
}

// --- Fotos de galería ------------------------------------------------------

const GALLERY_PHOTO_COLUMNS = `gp.id, gp.gallery_id, gp.object_id, gp.caption, gp.alt_text,
  gp.sort_order, gp.created_at, o.width, o.height, o.is_public`;

export async function listGalleryPhotos(
  db: D1Database,
  galleryId: number,
  limit?: number,
): Promise<GalleryPhotoRow[]> {
  // Las vistas públicas leen un número acotado de filas: el conjunto almacenado
  // ya está limitado por el servicio, pero acotar también aquí protege la ruta
  // anónima de cualquier conjunto heredado.
  const clause = limit === undefined ? '' : ' LIMIT ?';
  const params: unknown[] = [galleryId];
  if (limit !== undefined) params.push(Math.min(Math.max(Math.trunc(limit), 1), 200));
  return all<GalleryPhotoRow>(
    db,
    `SELECT ${GALLERY_PHOTO_COLUMNS}
       FROM gallery_photos gp
       JOIN storage_objects o ON o.id = gp.object_id
      WHERE gp.gallery_id = ? AND o.archived_at IS NULL
      ORDER BY gp.sort_order, gp.id${clause}`,
    ...params,
  );
}

/** Cuenta de fotos por galería, para los listados. */
export async function galleryPhotoCounts(
  db: D1Database,
  options: { publicOnly?: boolean } = {},
): Promise<{ gallery_id: number; total: number }[]> {
  const visibility = options.publicOnly ? ' AND o.is_public = 1' : '';
  return all<{ gallery_id: number; total: number }>(
    db,
    `SELECT gp.gallery_id, COUNT(*) AS total
       FROM gallery_photos gp
       JOIN storage_objects o ON o.id = gp.object_id
      WHERE o.archived_at IS NULL${visibility}
      GROUP BY gp.gallery_id`,
  );
}

export async function findGalleryPhoto(
  db: D1Database,
  galleryId: number,
  photoId: number,
): Promise<{ id: number } | null> {
  return first<{ id: number }>(
    db,
    `SELECT id FROM gallery_photos WHERE id = ? AND gallery_id = ?`,
    photoId,
    galleryId,
  );
}

export interface NewGalleryPhoto {
  objectId: number;
  caption: string | null;
  altText: string | null;
}

/** Sustituye las fotos de una galería por la lista indicada, en orden. */
export async function replaceGalleryPhotos(
  db: D1Database,
  galleryId: number,
  photos: NewGalleryPhoto[],
): Promise<number> {
  const now = nowIso();
  const statements = [stmt(db, `DELETE FROM gallery_photos WHERE gallery_id = ?`, galleryId)];
  photos.forEach((photo, index) => {
    statements.push(
      stmt(
        db,
        `INSERT INTO gallery_photos (gallery_id, object_id, caption, alt_text, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        galleryId,
        photo.objectId,
        photo.caption,
        photo.altText,
        index + 1,
        now,
      ),
    );
  });
  await batch(db, statements);
  return photos.length;
}

export async function deleteGalleryPhoto(
  db: D1Database,
  galleryId: number,
  photoId: number,
): Promise<number> {
  return changedRows(
    db,
    `DELETE FROM gallery_photos WHERE id = ? AND gallery_id = ?`,
    photoId,
    galleryId,
  );
}
