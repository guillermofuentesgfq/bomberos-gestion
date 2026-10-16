import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { sanitizeRichText } from '../lib/richtext';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import {
  addGalleryPhotos,
  createActivity,
  createGallery,
  createNews,
  createPage,
  getInstitutionConfig,
  getSeoConfig,
  listSiteSections,
  removeGalleryPhoto,
  reorderGalleryPhotos,
  reorderSiteSections,
  setGalleryPhotos,
  transitionContent,
  updateActivity,
  updateGallery,
  updateInstitutionConfig,
  updateNews,
  updatePage,
  updateSeoConfig,
  updateSiteSection,
  type ContentKind,
  type GalleryRow,
  type NewsRow,
  type PageRow,
  type ActivityRow,
} from '../services/cms';
import * as content from '../repositories/content';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Router administrativo del CMS. Debe montarse bajo un prefijo propio (por
 * ejemplo `/api/v1/site`); no se registra aquí.
 */
export const contentRoutes = new Hono<AppEnv>();

// --- Utilidades ------------------------------------------------------------

const idParam = z.coerce.number().int().positive();

function parseId(raw: string | undefined, label = 'identificador'): number {
  const parsed = idParam.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest(`${label} inválido.`);
  return parsed.data;
}

const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Usa un color hexadecimal, por ejemplo #b91c1c.');

// --- Configuración institucional -------------------------------------------

const seoPatchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(400).optional(),
  ogImageObjectId: z.number().int().positive().nullable().optional(),
  siteUrl: z.string().trim().max(300).optional(),
  allowIndexing: z.boolean().optional(),
});

const socialSchema = z.object({
  network: z.string().trim().min(1, 'Indica la red.').max(40),
  url: z.string().trim().url('La URL de la red no es válida.').max(500),
});

const institutionSchema = z.object({
  name: z.string().trim().max(200).optional(),
  number: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  history: z.string().max(20000).optional(),
  mission: z.string().max(4000).optional(),
  vision: z.string().max(4000).optional(),
  values: z.string().max(4000).optional(),
  corpsInfo: z.string().max(8000).optional(),
  shieldObjectId: z.number().int().positive().nullable().optional(),
  logoObjectId: z.number().int().positive().nullable().optional(),
  primaryColor: hexColor.optional(),
  secondaryColor: hexColor.optional(),
  address: z.string().trim().max(300).optional(),
  region: z.string().trim().max(120).optional(),
  commune: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  timezone: z.string().trim().max(80).optional(),
  emergencyNumber: z.string().trim().max(20).optional(),
  phones: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  emails: z.array(z.string().trim().email('Correo inválido.').max(160)).max(20).optional(),
  socials: z.array(socialSchema).max(20).optional(),
  specialties: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  seo: seoPatchSchema.optional(),
});

contentRoutes.get('/institution', requireAuth, requirePermission('site.read'), async (c) => {
  const [institution, seo] = await Promise.all([
    getInstitutionConfig(c.env.DB),
    getSeoConfig(c.env.DB),
  ]);
  return ok(c, { institution, seo });
});

contentRoutes.put(
  '/institution',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const body = await readJson(c, institutionSchema);
    const actor = actorFrom(c);
    const { seo, ...institutionPatch } = body;
    await updateInstitutionConfig(c.env.DB, institutionPatch, actor);
    if (seo) await updateSeoConfig(c.env.DB, seo, actor);
    return ok(c, { updated: true });
  },
);

contentRoutes.put(
  '/seo',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const body = await readJson(c, seoPatchSchema);
    await updateSeoConfig(c.env.DB, body, actorFrom(c));
    return ok(c, { updated: true });
  },
);

// --- Secciones -------------------------------------------------------------

contentRoutes.get('/sections', requireAuth, requirePermission('site.read'), async (c) => {
  return ok(c, { sections: await listSiteSections(c.env.DB) });
});

contentRoutes.post(
  '/sections/reorder',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const body = await readJson(
      c,
      z.object({ order: z.array(z.string().trim().min(1)).min(1, 'Indica el nuevo orden.') }),
    );
    await reorderSiteSections(c.env.DB, body.order, actorFrom(c));
    return ok(c, { updated: true });
  },
);

contentRoutes.put(
  '/sections/:key',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const key = c.req.param('key');
    const body = await readJson(
      c,
      z.object({
        isEnabled: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    );
    const section = await updateSiteSection(c.env.DB, key, body, actorFrom(c));
    return ok(c, { section });
  },
);

// --- DTOs ------------------------------------------------------------------

function pageDto(row: PageRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt,
    heroObjectId: row.hero_object_id,
    status: row.status,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newsDto(row: NewsRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    coverObjectId: row.cover_object_id,
    status: row.status,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activityDto(row: ActivityRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    locationText: row.location_text,
    coverObjectId: row.cover_object_id,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function galleryDto(row: GalleryRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Esquemas de contenido -------------------------------------------------

// El contenido del sitio se escribe con un editor visual, así que se guarda
// como HTML. Se sanea aquí, al escribir, para que en la base solo haya HTML
// seguro: el sitio público lo inserta directamente en el documento.
const richBody = z.string().max(100_000).transform((value) => sanitizeRichText(value));
const richText = (max: number) => z.string().trim().max(max).transform((value) => sanitizeRichText(value));

const pageSchema = z.object({
  slug: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  body: richBody.nullable().optional(),
  excerpt: richText(500).nullable().optional(),
  heroObjectId: z.number().int().positive().nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
});

const newsSchema = z.object({
  slug: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  summary: richText(500).nullable().optional(),
  body: richBody.nullable().optional(),
  coverObjectId: z.number().int().positive().nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
});

const activitySchema = z.object({
  slug: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  summary: richText(500).nullable().optional(),
  body: richBody.nullable().optional(),
  startsAt: z.string().trim().max(40).nullable().optional(),
  endsAt: z.string().trim().max(40).nullable().optional(),
  locationText: z.string().trim().max(200).nullable().optional(),
  coverObjectId: z.number().int().positive().nullable().optional(),
});

const gallerySchema = z.object({
  slug: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  description: richText(2000).nullable().optional(),
});

// --- Registro de sub-recursos por tipo -------------------------------------

type KindRoutes = {
  kind: ContentKind;
  label: string;
};

const KINDS: Record<'pages' | 'news' | 'activities' | 'galleries', KindRoutes> = {
  pages: { kind: 'page', label: 'página' },
  news: { kind: 'news', label: 'noticia' },
  activities: { kind: 'activity', label: 'actividad' },
  galleries: { kind: 'gallery', label: 'galería' },
};

// --- Páginas ---------------------------------------------------------------

contentRoutes.get('/pages', requireAuth, requirePermission('site.read'), async (c) => {
  const rows = await content.listPages(c.env.DB);
  return ok(c, { pages: rows.map(pageDto) });
});

contentRoutes.post('/pages', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const body = await readJson(c, pageSchema);
  const created = await createPage(c.env.DB, body, actorFrom(c));
  return ok(c, created, 201);
});

contentRoutes.get('/pages/:id', requireAuth, requirePermission('site.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'página');
  const row = await content.findPageById(c.env.DB, id);
  if (!row) throw AppError.notFound('Página no encontrada.');
  return ok(c, { page: pageDto(row) });
});

contentRoutes.put('/pages/:id', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'página');
  const body = await readJson(c, pageSchema);
  await updatePage(c.env.DB, id, body, actorFrom(c));
  return ok(c, { updated: true });
});

// --- Noticias --------------------------------------------------------------

contentRoutes.get('/news', requireAuth, requirePermission('site.read'), async (c) => {
  const rows = await content.listNews(c.env.DB);
  return ok(c, { news: rows.map(newsDto) });
});

contentRoutes.post('/news', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const body = await readJson(c, newsSchema);
  const created = await createNews(c.env.DB, body, actorFrom(c));
  return ok(c, created, 201);
});

contentRoutes.get('/news/:id', requireAuth, requirePermission('site.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'noticia');
  const row = await content.findNewsById(c.env.DB, id);
  if (!row) throw AppError.notFound('Noticia no encontrada.');
  return ok(c, { news: newsDto(row) });
});

contentRoutes.put('/news/:id', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'noticia');
  const body = await readJson(c, newsSchema);
  await updateNews(c.env.DB, id, body, actorFrom(c));
  return ok(c, { updated: true });
});

// --- Actividades -----------------------------------------------------------

contentRoutes.get('/activities', requireAuth, requirePermission('site.read'), async (c) => {
  const rows = await content.listActivities(c.env.DB);
  return ok(c, { activities: rows.map(activityDto) });
});

contentRoutes.post('/activities', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const body = await readJson(c, activitySchema);
  const created = await createActivity(c.env.DB, body, actorFrom(c));
  return ok(c, created, 201);
});

contentRoutes.get('/activities/:id', requireAuth, requirePermission('site.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'actividad');
  const row = await content.findActivityById(c.env.DB, id);
  if (!row) throw AppError.notFound('Actividad no encontrada.');
  return ok(c, { activity: activityDto(row) });
});

contentRoutes.put('/activities/:id', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'actividad');
  const body = await readJson(c, activitySchema);
  await updateActivity(c.env.DB, id, body, actorFrom(c));
  return ok(c, { updated: true });
});

// --- Galerías --------------------------------------------------------------

const photoInputSchema = z.object({
  objectId: z.number().int().positive(),
  caption: z.string().trim().max(500).nullable().optional(),
  altText: z.string().trim().max(300).nullable().optional(),
});

contentRoutes.get('/galleries', requireAuth, requirePermission('site.read'), async (c) => {
  const rows = await content.listGalleries(c.env.DB);
  return ok(c, { galleries: rows.map(galleryDto) });
});

contentRoutes.post('/galleries', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const body = await readJson(c, gallerySchema);
  const created = await createGallery(c.env.DB, body, actorFrom(c));
  return ok(c, created, 201);
});

contentRoutes.get('/galleries/:id', requireAuth, requirePermission('site.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'galería');
  const row = await content.findGalleryById(c.env.DB, id);
  if (!row) throw AppError.notFound('Galería no encontrada.');
  const photos = await content.listGalleryPhotos(c.env.DB, id);
  return ok(c, {
    gallery: galleryDto(row),
    photos: photos.map((photo) => ({
      id: photo.id,
      objectId: photo.object_id,
      caption: photo.caption,
      altText: photo.alt_text,
      sortOrder: photo.sort_order,
      isPublic: photo.is_public === 1,
    })),
  });
});

contentRoutes.put('/galleries/:id', requireAuth, requireCsrf, requirePermission('site.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'galería');
  const body = await readJson(c, gallerySchema);
  await updateGallery(c.env.DB, id, body, actorFrom(c));
  return ok(c, { updated: true });
});

contentRoutes.put(
  '/galleries/:id/photos',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'galería');
    const body = await readJson(c, z.object({ photos: z.array(photoInputSchema).max(200) }));
    const result = await setGalleryPhotos(c.env.DB, id, body.photos, actorFrom(c));
    return ok(c, result);
  },
);

contentRoutes.post(
  '/galleries/:id/photos',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'galería');
    const body = await readJson(
      c,
      z.object({ photos: z.array(photoInputSchema).min(1, 'Agrega al menos una foto.').max(200) }),
    );
    const result = await addGalleryPhotos(c.env.DB, id, body.photos, actorFrom(c));
    return ok(c, result, 201);
  },
);

contentRoutes.patch(
  '/galleries/:id/photos',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'galería');
    const body = await readJson(
      c,
      z.object({ order: z.array(z.number().int().positive()).min(1, 'Indica el nuevo orden.') }),
    );
    await reorderGalleryPhotos(c.env.DB, id, body.order, actorFrom(c));
    return ok(c, { reordered: true });
  },
);

contentRoutes.delete(
  '/galleries/:id/photos/:photoId',
  requireAuth,
  requireCsrf,
  requirePermission('site.write'),
  async (c) => {
    const id = parseId(c.req.param('id'), 'galería');
    const photoId = parseId(c.req.param('photoId'), 'foto');
    await removeGalleryPhoto(c.env.DB, id, photoId, actorFrom(c));
    return ok(c, { removed: true });
  },
);

// --- Transiciones editoriales ----------------------------------------------

/**
 * Registra publish/unpublish/archive para los cuatro tipos. Se hace con un
 * pequeño mapa para no repetir doce manejadores idénticos.
 */
const TRANSITIONS = ['publish', 'unpublish', 'archive'] as const;
type Transition = (typeof TRANSITIONS)[number];

for (const collection of ['pages', 'news', 'activities', 'galleries'] as const) {
  const meta = KINDS[collection];
  for (const action of TRANSITIONS) {
    contentRoutes.post(
      `/${collection}/:id/${action}`,
      requireAuth,
      requireCsrf,
      requirePermission('site.publish'),
      async (c) => {
        const id = parseId(c.req.param('id'), meta.label);
        const result = await transitionContent(c.env.DB, meta.kind, id, action as Transition, actorFrom(c));
        return ok(c, result);
      },
    );
  }
}
