import { Hono } from 'hono';
import { z } from 'zod';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { requireAuth, requireCsrf } from '../security/middleware';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  cookiesAreSecure,
  revokeSession,
} from '../security/sessions';
import { logAudit } from '../security/audit';
import { bootstrapAdmin, changeOwnPassword, login, needsSetup } from '../services/auth';

type AppEnv = { Bindings: Env; Variables: Variables };

export const authRoutes = new Hono<AppEnv>();

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'El usuario debe tener al menos 3 caracteres.')
  .max(64, 'El usuario es demasiado largo.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo.');

const passwordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(256, 'La contraseña es demasiado larga.');

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});

const setupSchema = z.object({
  token: z.string().min(1, 'Falta el token de inicialización.'),
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(120).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

function issueSessionCookie(
  c: Parameters<typeof setCookie>[0],
  value: string,
  secure: boolean,
): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Estado de la instalación y de la sesión actual. Endpoint público: permite a
 * la SPA saber si debe mostrar el asistente de inicialización o el login.
 */
authRoutes.get('/status', async (c) => {
  const user = c.get('user');
  return ok(c, {
    needsSetup: await needsSetup(c.env.DB),
    authenticated: user !== null,
    user,
    csrfToken: c.get('session')?.csrfToken ?? null,
  });
});

/** Inicializa el primer administrador y deja la sesión iniciada. */
authRoutes.post('/setup', async (c) => {
  const body = await readJson(c, setupSchema);
  await bootstrapAdmin(c.env, {
    username: body.username,
    password: body.password,
    displayName: body.displayName ?? null,
    token: body.token,
    ipHash: c.get('ipHash'),
  });

  const result = await login(c.env, {
    username: body.username,
    password: body.password,
    ipHash: c.get('ipHash'),
    userAgent: c.req.header('user-agent') ?? null,
  });
  issueSessionCookie(c, result.session.cookieValue, cookiesAreSecure(c.env));
  return ok(
    c,
    { user: result.user, csrfToken: result.session.csrfToken, expiresAt: result.session.expiresAt },
    201,
  );
});

/** Inicia sesión. */
authRoutes.post('/login', async (c) => {
  const body = await readJson(c, loginSchema);
  const result = await login(c.env, {
    username: body.username,
    password: body.password,
    ipHash: c.get('ipHash'),
    userAgent: c.req.header('user-agent') ?? null,
  });
  issueSessionCookie(c, result.session.cookieValue, cookiesAreSecure(c.env));
  return ok(c, {
    user: result.user,
    csrfToken: result.session.csrfToken,
    expiresAt: result.session.expiresAt,
  });
});

/** Cierra la sesión actual. */
authRoutes.post('/logout', requireAuth, requireCsrf, async (c) => {
  const session = c.get('session');
  const user = c.get('user');
  if (session) await revokeSession(c.env.DB, session.id);
  await logAudit(c.env.DB, {
    actorUserId: user?.id ?? null,
    actorLabel: user?.username ?? null,
    action: 'auth.logout',
    ipHash: c.get('ipHash'),
  });
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: cookiesAreSecure(c.env) });
  return ok(c, { loggedOut: true });
});

/** Identidad y capacidades de la sesión actual. */
authRoutes.get('/me', requireAuth, (c) => {
  const user = c.get('user');
  const session = c.get('session');
  if (!user || !session) throw AppError.unauthorized();
  return ok(c, {
    user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
});

/** Cambia la contraseña del propio usuario. */
authRoutes.post('/password', requireAuth, requireCsrf, async (c) => {
  const body = await readJson(c, changePasswordSchema);
  const user = c.get('user');
  const session = c.get('session');
  if (!user || !session) throw AppError.unauthorized();

  await changeOwnPassword(c.env, {
    userId: user.id,
    username: user.username,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    currentSessionId: session.id,
    ipHash: c.get('ipHash'),
  });
  return ok(c, { updated: true });
});
