import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env, Variables } from './lib/env';
import { AppError } from './lib/errors';
import { fail } from './lib/http';
import { api } from './routes';
import { seoRoutes } from './routes/public';
import { purgeStaleData } from './services/maintenance';

/** Tamaño máximo del cuerpo para endpoints JSON (las subidas usan su propio límite). */
const MAX_JSON_BYTES = 1 * 1024 * 1024; // 1 MB

/** Rutas que pueden recibir archivos y por tanto superan el límite JSON. */
const UPLOAD_PATH_PREFIXES = ['/api/v1/files'];

type AppEnv = { Bindings: Env; Variables: Variables };

const app = new Hono<AppEnv>();

// --- Identificador de petición ---------------------------------------------
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
});

// --- Cabeceras de seguridad y CSP ------------------------------------------
app.use('*', async (c, next) => {
  const mw = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'"],
      // Tailwind genera hojas propias; se admite estilo en línea solo para
      // atributos puntuales. Se revisará en la auditoría de frontend.
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
  return mw(c, next);
});

// --- Límite de tamaño de solicitud ----------------------------------------
app.use('/api/*', async (c, next) => {
  const isUpload = UPLOAD_PATH_PREFIXES.some((p) => c.req.path.startsWith(p));
  if (!isUpload) {
    const len = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(len) && len > MAX_JSON_BYTES) {
      throw AppError.payloadTooLarge();
    }
  }
  await next();
});

// --- API v1 ----------------------------------------------------------------
app.route('/api/v1', api);

// --- 404 uniforme para la API ----------------------------------------------
app.all('/api/*', () => {
  throw AppError.notFound('Endpoint no encontrado.');
});

// --- SEO del sitio público (sitemap.xml, robots.txt) ------------------------
app.route('/', seoRoutes);

// --- Fallback a la SPA (assets) --------------------------------------------
// El documento de la SPA lo sirve el Worker (`/` e `/index.html` están en
// `run_worker_first`), que lo toma del binding `ASSETS`. Las demás rutas las
// sirve la capa de assets directamente.
app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  // Las cabeceras de la respuesta de los assets son inmutables: se copia a una
  // respuesta propia para que el middleware de seguridad pueda añadir las suyas.
  return new Response(response.body, response);
});

// --- Manejo uniforme de errores --------------------------------------------
app.onError((err, c) => {
  if (err instanceof AppError) {
    return fail(c, err);
  }
  // Error no previsto: se registra sin datos sensibles y se responde genérico.
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: c.get('requestId'),
      path: c.req.path,
      message: err instanceof Error ? err.message : 'unknown',
    }),
  );
  return fail(c, AppError.internal());
});

app.notFound((c) => fail(c, AppError.notFound('Recurso no encontrado.')));

/**
 * El Worker expone `fetch` (la aplicación) y `scheduled`, que el cron diario de
 * `wrangler.jsonc` usa para limpiar datos caducados (sesiones, intentos de
 * ingreso y reservas de idempotencia). Sin él, esas tablas solo crecían.
 */
export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      purgeStaleData(env.DB)
        .then((summary) => {
          console.log(JSON.stringify({ level: 'info', message: 'maintenance.purge', ...summary }));
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: 'error',
              message: 'maintenance.purge_failed',
              detail: error instanceof Error ? error.message : 'unknown',
            }),
          );
        }),
    );
  },
} satisfies ExportedHandler<Env>;
