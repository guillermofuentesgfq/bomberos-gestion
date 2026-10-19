import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { requireSameOrigin } from '../security/middleware';
import { getInstitutionConfig, listSiteSections, normalizeSectionSettings, type ApplySectionSettings } from '../services/cms';
import { getObjectRecord, objectBody } from '../services/storage';
import { submitApplication } from '../services/applicants';
import { applicantMessage, channelIncludesContact, notify } from '../services/notifications';
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
 * Postulación pública.
 *
 * No exige sesión. La defensa es: mismo origen, límite por IP y un campo
 * trampa; el resultado es siempre el mismo mensaje genérico, para no revelar si
 * la postulación se guardó o se descartó por duplicada. La notificación a
 * Telegram se dispara fuera del ciclo de respuesta: **nunca** puede hacer
 * fallar ni retrasar el envío del postulante.
 */
const applicationSchema = z.object({
  fullName: z.string().trim().min(1, 'El nombre es obligatorio.').max(160),
  rut: z.string().trim().max(20).optional(),
  birthDate: z.string().trim().max(20).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(240).optional(),
  commune: z.string().trim().max(120).optional(),
  motivation: z.string().trim().max(4000).optional(),
  availability: z.string().trim().max(400).optional(),
  consent: z.boolean().refine((value) => value === true, {
    message: 'Debes autorizar el tratamiento de tus datos para postular.',
  }),
  /** Campo trampa: invisible para una persona, lo rellenan los robots. */
  website: z.string().max(200).optional(),
});

publicRoutes.post('/applications', requireSameOrigin, async (c) => {
  const body = await readJson(c, applicationSchema);

  // La sección tiene que estar publicada y abierta: un formulario cerrado no
  // debe seguir guardando datos personales aunque alguien llame a la API
  // directamente.
  const sections = await listSiteSections(c.env.DB);
  const applySection = sections.find((section) => section.key === 'apply');
  const applySettings = normalizeSectionSettings(
    'apply',
    applySection?.settings ?? {},
  ) as unknown as ApplySectionSettings;
  if (!applySection || !applySection.isEnabled || applySettings.isOpen !== true) {
    throw AppError.forbidden('Las postulaciones no están abiertas en este momento.');
  }

  const result = await submitApplication(
    c.env.DB,
    {
      fullName: body.fullName,
      rut: body.rut,
      birthDate: body.birthDate,
      email: body.email,
      phone: body.phone,
      address: body.address,
      commune: body.commune,
      motivation: body.motivation,
      availability: body.availability,
      consent: body.consent,
      honeypot: body.website,
    },
    c.get('ipHash'),
  );

  if (result.stored && result.id !== null) {
    const applicantId = result.id;
    const origin = new URL(c.req.url).origin;
    const includeContact = await channelIncludesContact(c.env.DB);
    const text = applicantMessage(
      {
        fullName: body.fullName,
        commune: body.commune ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        motivation: body.motivation ?? null,
        applicantId,
        origin,
      },
      includeContact,
    );
    const task = notify(c.env, { event: 'applicant.created', text });
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      // Sin executionCtx (pruebas): se espera para no dejar la promesa suelta.
      await task;
    }
  }

  return ok(c, { received: true }, 201);
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

/**
 * Icono de la pestaña.
 *
 * Se sirve el objeto configurado como **escudo** —y si no hay, el **logotipo**—
 * para que la pestaña lleve la identidad de la institución sin tener que subir
 * un archivo aparte ni tocar el repositorio. Solo se sirve si el objeto es
 * público: el icono lo pide el navegador sin sesión.
 *
 * La caché es corta a propósito: al cambiar el escudo conviene que el icono se
 * actualice en minutos, no en horas.
 */
async function serveIcon(c: Context<AppEnv>): Promise<Response> {
  const config = await getInstitutionConfig(c.env.DB);
  const objectId = config.shieldObjectId ?? config.logoObjectId;
  if (objectId === null) throw AppError.notFound();

  const record = await getObjectRecord(c.env.DB, objectId);
  if (!record || record.is_public !== 1) throw AppError.notFound();

  const object = await objectBody(c.env, record.object_key);
  if (!object) throw AppError.notFound();

  c.header('content-type', record.content_type);
  c.header('cache-control', 'public, max-age=60, stale-while-revalidate=86400');
  c.header('x-content-type-options', 'nosniff');
  if (object.httpEtag) c.header('etag', object.httpEtag);
  return c.body(object.body, 200);
}

seoRoutes.get('/favicon.ico', serveIcon);
seoRoutes.get('/apple-touch-icon.png', serveIcon);
