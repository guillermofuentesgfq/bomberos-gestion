import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { clientIpHash, CSRF_HEADER } from './request';
import { hasPermission, hasAnyPermission, type PermissionCode } from './permissions';
import { isSafeMethod, csrfMatches } from './csrf';
import { SESSION_COOKIE, resolveSession, touchSession } from './sessions';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Carga la identidad, la sesión y el hash de IP en el contexto. Se aplica a
 * todas las rutas de la API. No bloquea: las rutas deciden si exigen sesión.
 */
export const attachContext = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null);
  c.set('session', null);
  c.set('ipHash', await clientIpHash(c));

  const resolved = await resolveSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (resolved) {
    c.set('user', resolved.user);
    c.set('session', resolved.session);
    if (resolved.shouldTouch) {
      try {
        c.executionCtx.waitUntil(touchSession(c.env.DB, resolved.session.id));
      } catch {
        // Sin executionCtx (p. ej. en pruebas): se ignora el refresco.
      }
    }
  }

  await next();
});

/** Rutas accesibles aunque el usuario deba cambiar su contraseña. */
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/password',
  '/api/v1/auth/logout',
]);

/** Exige una sesión válida. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(c.req.path)) {
    throw AppError.forbidden('Debes cambiar la contraseña antes de continuar.');
  }
  await next();
});

/** Exige un permiso concreto, comprobado en el servidor. */
export function requirePermission(code: PermissionCode) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) throw AppError.unauthorized();
    if (!hasPermission(user.permissions, code)) throw AppError.forbidden();
    await next();
  });
}

/**
 * Exige al menos uno de los permisos indicados. Útil cuando una misma acción
 * sirve a áreas distintas; si las áreas exigen permisos distintos según el
 * objeto (como los archivos, que se autorizan por su ámbito), la comprobación
 * se hace en el manejador.
 */
export function requireAnyPermission(codes: readonly PermissionCode[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) throw AppError.unauthorized();
    if (!hasAnyPermission(user.permissions, codes)) throw AppError.forbidden();
    await next();
  });
}

/** Exige un token CSRF válido en operaciones con estado. */
export const requireCsrf = createMiddleware<AppEnv>(async (c, next) => {
  if (isSafeMethod(c.req.method)) {
    await next();
    return;
  }
  const session = c.get('session');
  if (!session) throw AppError.unauthorized();
  if (!csrfMatches(c.req.header(CSRF_HEADER), session.csrfToken)) {
    throw AppError.forbidden('Token CSRF ausente o inválido.');
  }
  await next();
});

/**
 * Defensa pre-sesión: exige que la petición venga del mismo sitio.
 *
 * Las mutaciones que no llevan sesión (iniciar sesión y la inicialización) no
 * pueden protegerse con CSRF porque no hay token todavía, y `SameSite` restringe
 * el **envío** de la cookie pero no su **fijación** por `Set-Cookie`: un
 * formulario de otro sitio podría iniciar sesión en el navegador de la víctima
 * (login CSRF) y dejarla operando bajo la cuenta del atacante. Se comprueba el
 * origen con las dos cabeceras que el navegador envía en estos casos.
 *
 * Las herramientas de línea de comandos no mandan ninguna de las dos y se
 * admiten: no son un navegador con credenciales ambientales.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('origin');
  if (origin !== undefined) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== new URL(c.req.url).host) {
      throw AppError.forbidden('La petición debe venir del mismo sitio.');
    }
  }

  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw AppError.forbidden('La petición debe venir del mismo sitio.');
  }

  await next();
});
