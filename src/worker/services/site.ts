import * as content from '../repositories/content';
import {
  getInstitutionConfig,
  getSeoConfig,
  listSiteSections,
  normalizeSectionSettings,
  MAX_GALLERY_PHOTOS,
  type SocialLink,
} from './cms';

/**
 * Composición de la vista pública.
 *
 * Solo se expone contenido **publicado** y únicamente imágenes marcadas como
 * públicas en `storage_objects` (`is_public = 1`). Las páginas archivadas o en
 * borrador y las rutas privadas (`/admin`, `/api`) quedan fuera del sitemap.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface PublicImage {
  id: number;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface PublicInstitution {
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

/** Límite de elementos recientes que se incluyen en la portada. */
const HOME_LIMIT = 6;
const MAX_LIST_LIMIT = 100;

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/** URL pública del objeto. Las imágenes se sirven por el Worker. */
export function objectUrl(id: number): string {
  return `/api/v1/files/${id}`;
}

function toPublicImage(
  row: content.ObjectSummaryRow | undefined,
): PublicImage | null {
  if (!row || row.is_public !== 1) return null;
  return {
    id: row.id,
    url: objectUrl(row.id),
    alt: row.alt_text,
    width: row.width,
    height: row.height,
  };
}

/** Carga en bloque los objetos referenciados y devuelve un mapa id → imagen. */
async function imageMap(
  db: D1Database,
  ids: (number | null)[],
): Promise<Map<number, PublicImage>> {
  const rows = await content.listObjectSummaries(db, ids);
  const map = new Map<number, PublicImage>();
  for (const row of rows) {
    const image = toPublicImage(row);
    if (image) map.set(row.id, image);
  }
  return map;
}

function firstImage(map: Map<number, PublicImage>, id: number | null): PublicImage | null {
  if (id === null) return null;
  return map.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Composición de la portada
// ---------------------------------------------------------------------------

export async function getPublicSite(db: D1Database): Promise<PublicSite> {
  const [institution, seo, allSections, pages, news, activities, galleries] = await Promise.all([
    getInstitutionConfig(db),
    getSeoConfig(db),
    listSiteSections(db),
    content.listPublishedPages(db),
    content.listPublishedNews(db, HOME_LIMIT),
    content.listPublishedActivities(db, HOME_LIMIT),
    listPublicGalleries(db),
  ]);

  const ids: (number | null)[] = [
    institution.shieldObjectId,
    institution.logoObjectId,
    institution.coverObjectId,
    seo.ogImageObjectId,
    ...pages.map((page) => page.hero_object_id),
    ...news.map((item) => item.cover_object_id),
    ...activities.map((item) => item.cover_object_id),
  ];
  const images = await imageMap(db, ids);

  const sections: PublicSection[] = allSections
    .filter((section) => section.isEnabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({
      key: section.key,
      sortOrder: section.sortOrder,
      // Se vuelve a normalizar al leer: el saneado del HTML también ocurre al
      // guardar, pero así un dato antiguo o manipulado no llega al público.
      settings: normalizeSectionSettings(section.key, section.settings),
    }));

  return {
    institution: {
      name: institution.name,
      number: institution.number,
      corpsName: institution.corpsName,
      description: institution.description,
      history: institution.history,
      mission: institution.mission,
      vision: institution.vision,
      values: institution.values,
      corpsInfo: institution.corpsInfo,
      shield: firstImage(images, institution.shieldObjectId),
      logo: firstImage(images, institution.logoObjectId),
      cover: firstImage(images, institution.coverObjectId),
      primaryColor: institution.primaryColor,
      secondaryColor: institution.secondaryColor,
      address: institution.address,
      region: institution.region,
      commune: institution.commune,
      country: institution.country,
      emergencyNumber: institution.emergencyNumber,
      phones: institution.phones,
      emails: institution.emails,
      socials: institution.socials,
      specialties: institution.specialties,
    },
    seo: {
      title: seo.title,
      description: seo.description,
      ogImage: firstImage(images, seo.ogImageObjectId),
      siteUrl: seo.siteUrl,
      allowIndexing: seo.allowIndexing,
    },
    sections,
    pages: pages.map((page) => ({
      slug: page.slug,
      title: page.title,
      excerpt: page.excerpt,
      publishedAt: page.published_at,
      updatedAt: page.updated_at,
      hero: firstImage(images, page.hero_object_id),
    })),
    news: news.map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      publishedAt: item.published_at,
      cover: firstImage(images, item.cover_object_id),
    })),
    activities: activities.map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      locationText: item.location_text,
      publishedAt: item.published_at,
      cover: firstImage(images, item.cover_object_id),
    })),
    galleries,
  };
}

// ---------------------------------------------------------------------------
// Listados y detalles del sitio público
// ---------------------------------------------------------------------------

export async function listPublicNews(
  db: D1Database,
  limit: number,
): Promise<PublicNewsSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
  const rows = await content.listPublishedNews(db, safeLimit);
  const images = await imageMap(db, rows.map((row) => row.cover_object_id));
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    cover: firstImage(images, row.cover_object_id),
  }));
}

export async function listPublicActivities(
  db: D1Database,
  limit: number,
): Promise<PublicActivitySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
  const rows = await content.listPublishedActivities(db, safeLimit);
  const images = await imageMap(db, rows.map((row) => row.cover_object_id));
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    locationText: row.location_text,
    publishedAt: row.published_at,
    cover: firstImage(images, row.cover_object_id),
  }));
}

export async function listPublicGalleries(db: D1Database): Promise<PublicGallerySummary[]> {
  const [galleries, counts] = await Promise.all([
    content.listPublishedGalleries(db),
    content.galleryPhotoCounts(db, { publicOnly: true }),
  ]);
  const countMap = new Map(counts.map((row) => [row.gallery_id, row.total]));

  const images = new Map<number, PublicImage>();
  for (const gallery of galleries) {
    // Solo se usa la primera foto pública de la galería como portada: se lee un
    // número acotado de filas por galería, no el conjunto entero.
    const photos = await content.listGalleryPhotos(db, gallery.id, MAX_GALLERY_PHOTOS);
    const publicPhoto = photos.find((photo) => photo.is_public === 1);
    if (publicPhoto) {
      const image = toPublicImage({
        id: publicPhoto.object_id,
        content_type: 'image/*',
        width: publicPhoto.width,
        height: publicPhoto.height,
        alt_text: publicPhoto.alt_text,
        caption: publicPhoto.caption,
        is_public: publicPhoto.is_public,
      });
      if (image) images.set(gallery.id, image);
    }
  }

  return galleries.map((gallery) => ({
    slug: gallery.slug,
    title: gallery.title,
    description: gallery.description,
    photoCount: countMap.get(gallery.id) ?? 0,
    cover: images.get(gallery.id) ?? null,
  }));
}

export async function getPublicPageBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicPageDetail | null> {
  const page = await content.findPublishedPageBySlug(db, slug);
  if (!page) return null;
  const images = await imageMap(db, [page.hero_object_id]);
  return {
    slug: page.slug,
    title: page.title,
    excerpt: page.excerpt,
    body: page.body,
    seoTitle: page.seo_title,
    seoDescription: page.seo_description,
    publishedAt: page.published_at,
    updatedAt: page.updated_at,
    hero: firstImage(images, page.hero_object_id),
  };
}

export async function getPublicNewsBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicNewsDetail | null> {
  const item = await content.findPublishedNewsBySlug(db, slug);
  if (!item) return null;
  const images = await imageMap(db, [item.cover_object_id]);
  return {
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    body: item.body,
    seoTitle: item.seo_title,
    seoDescription: item.seo_description,
    publishedAt: item.published_at,
    cover: firstImage(images, item.cover_object_id),
  };
}

export async function getPublicActivityBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicActivityDetail | null> {
  const item = await content.findPublishedActivityBySlug(db, slug);
  if (!item) return null;
  const images = await imageMap(db, [item.cover_object_id]);
  return {
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    body: item.body,
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    locationText: item.location_text,
    publishedAt: item.published_at,
    cover: firstImage(images, item.cover_object_id),
  };
}

export async function getPublicGalleryBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicGalleryDetail | null> {
  const gallery = await content.findPublishedGalleryBySlug(db, slug);
  if (!gallery) return null;
  // La lectura pública se acota en SQL: la galería no puede servir un número
  // ilimitado de fotos a un visitante anónimo.
  const photos = await content.listGalleryPhotos(db, gallery.id, MAX_GALLERY_PHOTOS);
  const images: PublicImage[] = photos.flatMap((photo) => {
    const image = toPublicImage({
      id: photo.object_id,
      content_type: 'image/*',
      width: photo.width,
      height: photo.height,
      alt_text: photo.alt_text,
      caption: photo.caption,
      is_public: photo.is_public,
    });
    return image ? [image] : [];
  });
  return {
    slug: gallery.slug,
    title: gallery.title,
    description: gallery.description,
    photos: images,
  };
}

// ---------------------------------------------------------------------------
// SEO: sitemap.xml y robots.txt
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** Rutas estáticas públicas del sitio, siempre indexables. */
const STATIC_PATHS: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/noticias', changefreq: 'daily', priority: '0.8' },
  { path: '/actividades', changefreq: 'weekly', priority: '0.7' },
  { path: '/galerias', changefreq: 'monthly', priority: '0.6' },
];

export async function buildSitemap(db: D1Database, origin: string): Promise<string> {
  const base = trimOrigin(origin);
  const [pages, news, activities, galleries] = await Promise.all([
    content.listPublishedPages(db),
    content.listPublishedNews(db, MAX_LIST_LIMIT),
    content.listPublishedActivities(db, MAX_LIST_LIMIT),
    content.listPublishedGalleries(db),
  ]);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const entry of STATIC_PATHS) {
    lines.push(
      `  <url><loc>${escapeXml(`${base}${entry.path}`)}</loc>` +
        `<changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`,
    );
  }

  const push = (path: string, lastmod: string | null, changefreq: string, priority: string): void => {
    const lastmodTag = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : '';
    lines.push(
      `  <url><loc>${escapeXml(`${base}${path}`)}</loc>${lastmodTag}` +
        `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
    );
  };

  for (const page of pages) push(`/paginas/${page.slug}`, page.updated_at, 'monthly', '0.6');
  for (const item of news) push(`/noticias/${item.slug}`, item.published_at, 'monthly', '0.7');
  for (const item of activities) push(`/actividades/${item.slug}`, item.published_at, 'monthly', '0.6');
  for (const gallery of galleries) push(`/galerias/${gallery.slug}`, gallery.updated_at, 'monthly', '0.5');

  lines.push('</urlset>');
  return lines.join('\n');
}

export async function buildRobots(db: D1Database, origin: string): Promise<string> {
  const seo = await getSeoConfig(db);
  const base = trimOrigin(origin);

  if (!seo.allowIndexing) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }

  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /panel',
    'Disallow: /api/',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}
