import type { AuthUser, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import { constantTimeEqual } from '../lib/crypto';
import { addSeconds, isPast, nowIso } from '../lib/time';
import { hashPassword, verifyPassword, isPasswordAcceptable } from '../security/passwords';
import { logAudit } from '../security/audit';
import { createSession, revokeUserSessions, type CreatedSession } from '../security/sessions';
import { loadUserPermissions, loadUserRoles } from '../security/permissions';
import * as users from '../repositories/users';

/** Umbral de fallos y tiempos de bloqueo. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_SECONDS = 15 * 60;
const WINDOW_SECONDS = 15 * 60;

function requirePepper(env: Env): string {
  const pepper = env.AUTH_PASSWORD_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw AppError.internal('Falta configurar AUTH_PASSWORD_PEPPER en este entorno.');
  }
  return pepper;
}

/** ¿La instalación todavía no tiene ningún usuario? */
export async function needsSetup(db: D1Database): Promise<boolean> {
  return (await users.countUsers(db)) === 0;
}

export interface BootstrapInput {
  username: string;
  password: string;
  displayName: string | null;
  token: string;
  ipHash: string | null;
}

/**
 * Inicializa el primer administrador. Solo funciona si no existe ningún
 * usuario y el token de arranque coincide.
 */
export async function bootstrapAdmin(env: Env, input: BootstrapInput): Promise<number> {
  if (!env.BOOTSTRAP_TOKEN) {
    throw AppError.forbidden('La inicialización no está habilitada en este entorno.');
  }

  // Misma limitación que el ingreso: sin ella, el token de arranque se podía
  // adivinar sin tope en una instalación recién desplegada.
  const since = addSeconds(nowIso(), -WINDOW_SECONDS);
  if (input.ipHash) {
    const ipFailures = await users.recentFailuresForIp(env.DB, input.ipHash, since);
    if (ipFailures >= MAX_FAILED_ATTEMPTS * 4) {
      throw AppError.tooManyRequests('Demasiados intentos desde esta conexión.');
    }
  }

  if (!constantTimeEqual(input.token, env.BOOTSTRAP_TOKEN)) {
    await users.recordLoginAttempt(env.DB, input.username, input.ipHash, false);
    throw AppError.forbidden('Token de inicialización inválido.');
  }
  if (!(await needsSetup(env.DB))) {
    throw AppError.conflict('La instalación ya está inicializada.');
  }
  if (!isPasswordAcceptable(input.password)) {
    throw AppError.unprocessable('La contraseña debe tener al menos 12 caracteres.');
  }

  const hashed = await hashPassword(input.password, requirePepper(env));
  const userId = await users.insertUser(
    env.DB,
    {
      username: input.username,
      email: null,
      displayName: input.displayName,
      password: hashed,
      mustChangePassword: false,
    },
    ['admin'],
  );

  await logAudit(env.DB, {
    actorUserId: userId,
    actorLabel: input.username,
    action: 'auth.bootstrap',
    entityType: 'user',
    entityId: userId,
    detail: { roles: ['admin'] },
    ipHash: input.ipHash,
  });

  return userId;
}

export interface LoginInput {
  username: string;
  password: string;
  ipHash: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  session: CreatedSession;
  user: AuthUser;
}

/**
 * Autentica a un usuario. Aplica limitación de intentos por cuenta e IP y
 * bloqueo temporal. No revela si el usuario existe.
 */
export async function login(env: Env, input: LoginInput): Promise<LoginResult> {
  const db = env.DB;
  const since = addSeconds(nowIso(), -WINDOW_SECONDS);

  if (input.ipHash) {
    const ipFailures = await users.recentFailuresForIp(db, input.ipHash, since);
    if (ipFailures >= MAX_FAILED_ATTEMPTS * 4) {
      throw AppError.tooManyRequests('Demasiados intentos desde esta conexión.');
    }
  }

  const account = await users.findUserByUsername(db, input.username);

  // Igualar el tiempo de respuesta cuando el usuario no existe.
  if (!account) {
    await hashPassword(input.password, requirePepper(env));
    await users.recordLoginAttempt(db, input.username, input.ipHash, false);
    throw AppError.unauthorized('Usuario o contraseña incorrectos.');
  }

  // La contraseña se verifica **antes** de revelar el estado de la cuenta: si el
  // bloqueo o la desactivación se comprobaran antes, un 429 o un 403 distintos
  // del 401 permitirían descubrir qué nombres de usuario existen sin conocer la
  // contraseña.
  const ok = await verifyPassword(input.password, account, requirePepper(env));
  if (!ok) {
    // Un bloqueo vigente no se cuenta ni se acorta: los intentos durante el
    // bloqueo no alimentan el contador (si no, un fallo más lo reabriría).
    const wasLocked = account.locked_until !== null && !isPast(account.locked_until);
    if (!wasLocked) {
      const failures = account.failed_attempts + 1;
      const lockUntil =
        failures >= MAX_FAILED_ATTEMPTS ? addSeconds(nowIso(), LOCK_SECONDS) : null;
      await users.registerFailure(db, account.id, lockUntil);
    }
    await users.recordLoginAttempt(db, account.username, input.ipHash, false);
    await logAudit(db, {
      actorUserId: account.id,
      actorLabel: account.username,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: account.id,
      detail: { locked: wasLocked },
      ipHash: input.ipHash,
    });
    throw AppError.unauthorized('Usuario o contraseña incorrectos.');
  }

  if (account.locked_until && !isPast(account.locked_until)) {
    throw AppError.tooManyRequests('La cuenta está bloqueada temporalmente.');
  }
  if (account.is_active !== 1) {
    throw AppError.forbidden('La cuenta está desactivada.');
  }

  await users.markLoginSuccess(db, account.id);
  await users.recordLoginAttempt(db, account.username, input.ipHash, true);

  const session = await createSession(db, account.id, input.userAgent, input.ipHash);
  const [roles, permissions] = await Promise.all([
    loadUserRoles(db, account.id),
    loadUserPermissions(db, account.id),
  ]);

  await logAudit(db, {
    actorUserId: account.id,
    actorLabel: account.username,
    action: 'auth.login',
    entityType: 'user',
    entityId: account.id,
    ipHash: input.ipHash,
  });

  return {
    session,
    user: {
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      roles,
      permissions,
      mustChangePassword: account.must_change_password === 1,
    },
  };
}

export interface ChangePasswordInput {
  userId: number;
  currentPassword: string;
  newPassword: string;
  currentSessionId: string;
  username: string;
  ipHash: string | null;
}

/** Cambia la contraseña del propio usuario y revoca el resto de sesiones. */
export async function changeOwnPassword(env: Env, input: ChangePasswordInput): Promise<void> {
  const account = await users.findUserById(env.DB, input.userId);
  if (!account) throw AppError.unauthorized();

  const ok = await verifyPassword(input.currentPassword, account, requirePepper(env));
  if (!ok) throw AppError.forbidden('La contraseña actual no coincide.');

  if (!isPasswordAcceptable(input.newPassword)) {
    throw AppError.unprocessable('La nueva contraseña debe tener al menos 12 caracteres.');
  }
  if (input.newPassword === input.currentPassword) {
    throw AppError.unprocessable('La nueva contraseña debe ser distinta de la actual.');
  }

  const hashed = await hashPassword(input.newPassword, requirePepper(env));
  await users.setPassword(env.DB, input.userId, hashed, false);
  await revokeUserSessions(env.DB, input.userId, input.currentSessionId);

  await logAudit(env.DB, {
    actorUserId: input.userId,
    actorLabel: input.username,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: input.userId,
    ipHash: input.ipHash,
  });
}

/** Construye el `AuthUser` para las respuestas de sesión. */
export function toAuthUser(account: users.UserRecord, roles: string[], permissions: string[]): AuthUser {
  return {
    id: account.id,
    username: account.username,
    displayName: account.display_name,
    roles,
    permissions,
    mustChangePassword: account.must_change_password === 1,
  };
}
