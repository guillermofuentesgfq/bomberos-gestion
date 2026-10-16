import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import {
  buildRobots,
  buildSitemap,
  getPublicActivityBySlug,
  getPublicGalleryBySlug,
  getPublicNewsBySlug,
  getPublicPageBySlug,
  getPublicSite,
  listPublicActivities,
  listPublicGalleries,
  listPublicNews,
} from '../services/site';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Router público del sitio institucional. No exige sesión: solo devuelve
 * contenido publicado. Debe montarse bajo el prefijo `/api/v1`.
 */
export const publicRoutes = new Hono<AppEnv>();

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

function readLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIST_LIMIT);
}

/**
 * Caché breve en el borde: el contenido cambia con poca frecuencia, pero al
 * configurar la institución conviene que los cambios se vean casi de inmediato.
 */
const publicCache = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.header('cache-control', 'public, max-age=10, stale-while-revalidate=60');
  }
});

publicRoutes.get('/site', publicCache, async (c) => {
  return ok(c, await getPublicSite(c.env.DB));
});

publicRoutes.get('/pages/:slug', publicCache, async (c) => {
  const page = await getPublicPageBySlug(c.env.DB, c.req.param('slug'));
  if (!page) throw AppError.notFound('Página no encontrada.');
  return ok(c, { page });
});

publicRoutes.get('/news', publicCache, async (c) => {
  const news = await listPublicNews(c.env.DB, readLimit(c.req.query('limit')));
  return ok(c, { news });
});

publicRoutes.get('/news/:slug', publicCache, async (c) => {
  const item = await getPublicNewsBySlug(c.env.DB, c.req.param('slug'));
  if (!item) throw AppError.notFound('Noticia no encontrada.');
  return ok(c, { news: item });
});

publicRoutes.get('/activities', publicCache, async (c) => {
  const activities = await listPublicActivities(c.env.DB, readLimit(c.req.query('limit')));
  return ok(c, { activities });
});

publicRoutes.get('/activities/:slug', publicCache, async (c) => {
  const activity = await getPublicActivityBySlug(c.env.DB, c.req.param('slug'));
  if (!activity) throw AppError.notFound('Actividad no encontrada.');
  return ok(c, { activity });
});

publicRoutes.get('/galleries', publicCache, async (c) => {
  const galleries = await listPublicGalleries(c.env.DB);
  return ok(c, { galleries });
});

publicRoutes.get('/galleries/:slug', publicCache, async (c) => {
  const gallery = await getPublicGalleryBySlug(c.env.DB, c.req.param('slug'));
  if (!gallery) throw AppError.notFound('Galería no encontrada.');
  return ok(c, { gallery });
});

/**
 * Rutas de descubrimiento del sitio. Deben montarse en la raíz del Worker
 * (`/sitemap.xml`, `/robots.txt`) para que los buscadores las encuentren.
 */
export const seoRoutes = new Hono<AppEnv>();

seoRoutes.get('/sitemap.xml', async (c) => {
  const xml = await buildSitemap(c.env.DB, new URL(c.req.url).origin);
  c.header('content-type', 'application/xml; charset=utf-8');
  c.header('cache-control', 'public, max-age=3600');
  return c.body(xml, 200);
});

seoRoutes.get('/robots.txt', async (c) => {
  const text = await buildRobots(c.env.DB, new URL(c.req.url).origin);
  c.header('content-type', 'text/plain; charset=utf-8');
  c.header('cache-control', 'public, max-age=3600');
  return c.body(text, 200);
});
