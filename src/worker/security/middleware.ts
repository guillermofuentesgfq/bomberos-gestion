import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { clientIpHash, CSRF_HEADER } from './request';
import { hasPermission, type PermissionCode } from './permissions';
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
