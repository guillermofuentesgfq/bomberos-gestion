import type { AuthUser, Env, SessionInfo } from '../lib/env';
import { constantTimeEqualHex, sha256Hex } from '../lib/crypto';
import { first, run } from '../lib/db';
import { randomId, randomToken } from '../lib/ids';
import { addSeconds, isPast, nowIso } from '../lib/time';
import { loadUserPermissions, loadUserRoles } from './permissions';

/** Nombre de la cookie de sesión. */
export const SESSION_COOKIE = 'bg_session';

/** Duración por defecto de una sesión: 8 horas. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Cada cuánto se refresca `last_seen_at` (evita una escritura por petición). */
const LAST_SEEN_THROTTLE_SECONDS = 300;

interface SessionRow {
  id: string;
  user_id: number;
  token_hash: string;
  csrf_secret: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  is_active: number;
  must_change_password: number;
}

export interface CreatedSession {
  sessionId: string;
  /** Valor completo de la cookie: `id.secreto`. */
  cookieValue: string;
  csrfToken: string;
  expiresAt: string;
}

export interface ResolvedSession {
  user: AuthUser;
  session: SessionInfo;
  lastSeenAt: string;
  /** Si es true, conviene refrescar `last_seen_at`. */
  shouldTouch: boolean;
}

/** Crea una sesión nueva y devuelve el valor de cookie y el token CSRF. */
export async function createSession(
  db: D1Database,
  userId: number,
  userAgent: string | null,
  ipHash: string | null,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<CreatedSession> {
  const sessionId = randomId(16);
  const secret = randomToken(32);
  const tokenHash = await sha256Hex(secret);
  const csrfSecret = randomToken(32);
  const now = nowIso();
  const expiresAt = addSeconds(now, ttlSeconds);

  await run(
    db,
    `INSERT INTO sessions
       (id, user_id, token_hash, csrf_secret, created_at, last_seen_at, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    userId,
    tokenHash,
    csrfSecret,
    now,
    now,
    expiresAt,
    userAgent,
    ipHash,
  );

  return { sessionId, cookieValue: `${sessionId}.${secret}`, csrfToken: csrfSecret, expiresAt };
}

/** Separa el valor de cookie en id y secreto. */
export function parseCookieValue(value: string | undefined): { id: string; secret: string } | null {
  if (!value) return null;
  const index = value.indexOf('.');
  if (index <= 0 || index === value.length - 1) return null;
  return { id: value.slice(0, index), secret: value.slice(index + 1) };
}

/**
 * Resuelve una sesión a partir del valor de cookie. Devuelve null si la sesión
 * no existe, está revocada, caducó o el secreto no coincide.
 */
export async function resolveSession(
  db: D1Database,
  cookieValue: string | undefined,
): Promise<ResolvedSession | null> {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return null;

  const session = await first<SessionRow>(
    db,
    `SELECT id, user_id, token_hash, csrf_secret, expires_at, revoked_at, last_seen_at
       FROM sessions WHERE id = ?`,
    parsed.id,
  );
  if (!session || session.revoked_at !== null) return null;
  if (isPast(session.expires_at)) return null;

  const candidate = await sha256Hex(parsed.secret);
  if (!constantTimeEqualHex(candidate, session.token_hash)) return null;

  const user = await first<UserRow>(
    db,
    `SELECT id, username, display_name, is_active, must_change_password
       FROM users WHERE id = ? AND archived_at IS NULL`,
    session.user_id,
  );
  if (!user || user.is_active !== 1) return null;

  const [roles, permissions] = await Promise.all([
    loadUserRoles(db, user.id),
    loadUserPermissions(db, user.id),
  ]);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      roles,
      permissions,
      mustChangePassword: user.must_change_password === 1,
    },
    session: {
      id: session.id,
      csrfToken: session.csrf_secret,
      expiresAt: session.expires_at,
    },
    lastSeenAt: session.last_seen_at,
    shouldTouch:
      new Date(nowIso()).getTime() - new Date(session.last_seen_at).getTime() >
      LAST_SEEN_THROTTLE_SECONDS * 1000,
  };
}

/** Refresca `last_seen_at` de la sesión indicada. */
export async function touchSession(db: D1Database, sessionId: string): Promise<void> {
  await run(db, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, nowIso(), sessionId);
}

/** Revoca una sesión concreta. */
export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await run(db, `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, nowIso(), sessionId);
}

/** Revoca todas las sesiones de un usuario (p. ej. al cambiar la contraseña). */
export async function revokeUserSessions(
  db: D1Database,
  userId: number,
  exceptSessionId?: string,
): Promise<void> {
  const now = nowIso();
  if (exceptSessionId) {
    await run(
      db,
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
      now,
      userId,
      exceptSessionId,
    );
    return;
  }
  await run(
    db,
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    now,
    userId,
  );
}

/** ¿Debe marcarse la cookie como Secure? En producción siempre. */
export function cookiesAreSecure(env: Env): boolean {
  return env.APP_ENV !== 'development';
}
