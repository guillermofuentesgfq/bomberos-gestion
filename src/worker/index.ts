import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env, Variables } from './lib/env';
import { AppError } from './lib/errors';
import { jsonError } from './lib/http';
import { api } from './routes';

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

// --- Fallback a la SPA (assets) --------------------------------------------
// En producción, Cloudflare sirve los assets sin invocar el Worker salvo en
// /api/*. Este fallback cubre el desarrollo local y rutas no-API.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// --- Manejo uniforme de errores --------------------------------------------
app.onError((err, c) => {
  if (err instanceof AppError) {
    return jsonError(err);
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
  return jsonError(AppError.internal());
});

app.notFound(() => jsonError(AppError.notFound('Recurso no encontrado.')));

export default app;
