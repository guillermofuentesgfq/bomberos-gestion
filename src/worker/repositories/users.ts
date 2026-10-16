import { all, batch, first, run, stmt } from '../lib/db';
import { nowIso } from '../lib/time';
import type { HashedPassword, StoredPassword } from '../security/passwords';

export interface UserRecord extends StoredPassword {
  id: number;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: number;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
}

const USER_COLUMNS = `id, username, email, display_name,
  password_hash, password_salt, password_iterations, password_algo,
  is_active, must_change_password, failed_attempts, locked_until`;

/** Número total de usuarios (para saber si la instalación está inicializada). */
export async function countUsers(db: D1Database): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM users WHERE archived_at IS NULL`,
  );
  return row?.total ?? 0;
}

export async function findUserByUsername(
  db: D1Database,
  username: string,
): Promise<UserRecord | null> {
  return first<UserRecord>(
    db,
    `SELECT ${USER_COLUMNS} FROM users WHERE username = ? COLLATE NOCASE AND archived_at IS NULL`,
    username,
  );
}

export async function findUserById(db: D1Database, id: number): Promise<UserRecord | null> {
  return first<UserRecord>(
    db,
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND archived_at IS NULL`,
    id,
  );
}

export interface NewUser {
  username: string;
  email: string | null;
  displayName: string | null;
  password: HashedPassword;
  mustChangePassword: boolean;
}

/** Inserta un usuario y le asigna roles por código. Devuelve el id. */
export async function insertUser(
  db: D1Database,
  user: NewUser,
  roleCodes: string[],
): Promise<number> {
  const now = nowIso();
  const created = await run(
    db,
    `INSERT INTO users
       (username, email, display_name, password_hash, password_salt, password_iterations,
        password_algo, is_active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    user.username,
    user.email,
    user.displayName,
    user.password.hash,
    user.password.salt,
    user.password.iterations,
    user.password.algo,
    user.mustChangePassword ? 1 : 0,
    now,
    now,
  );
  const userId = Number(created.meta.last_row_id);

  // Los roles se asignan en un solo lote con los códigos desduplicados: un
  // código repetido violaría la clave primaria de `user_roles` a mitad de
  // secuencia y dejaría la cuenta a medio crear.
  const codes = [...new Set(roleCodes)];
  if (codes.length > 0) {
    await batch(
      db,
      codes.map((code) =>
        stmt(
          db,
          `INSERT INTO user_roles (user_id, role_id)
             SELECT ?, id FROM roles WHERE code = ? AND archived_at IS NULL`,
          userId,
          code,
        ),
      ),
    );
  }
  return userId;
}

export async function setPassword(
  db: D1Database,
  userId: number,
  password: HashedPassword,
  mustChange: boolean,
): Promise<void> {
  await run(
    db,
    `UPDATE users
        SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algo = ?,
            must_change_password = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    password.hash,
    password.salt,
    password.iterations,
    password.algo,
    mustChange ? 1 : 0,
    nowIso(),
    userId,
  );
}

/** Registra un intento de acceso (para limitar la fuerza bruta). */
export async function recordLoginAttempt(
  db: D1Database,
  username: string | null,
  ipHash: string | null,
  success: boolean,
): Promise<void> {
  await run(
    db,
    `INSERT INTO login_attempts (username, ip_hash, success, created_at) VALUES (?, ?, ?, ?)`,
    username,
    ipHash,
    success ? 1 : 0,
    nowIso(),
  );
}

/** Cuenta intentos fallidos recientes por usuario. */
export async function recentFailuresForUser(
  db: D1Database,
  username: string,
  sinceIso: string,
): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM login_attempts
      WHERE success = 0 AND username = ? COLLATE NOCASE AND created_at >= ?`,
    username,
    sinceIso,
  );
  return row?.total ?? 0;
}

/** Cuenta intentos fallidos recientes por IP. */
export async function recentFailuresForIp(
  db: D1Database,
  ipHash: string,
  sinceIso: string,
): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM login_attempts
      WHERE success = 0 AND ip_hash = ? AND created_at >= ?`,
    ipHash,
    sinceIso,
  );
  return row?.total ?? 0;
}

export async function markLoginSuccess(db: D1Database, userId: number): Promise<void> {
  await run(
    db,
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
      WHERE id = ?`,
    nowIso(),
    nowIso(),
    userId,
  );
}

export async function registerFailure(
  db: D1Database,
  userId: number,
  lockUntilIso: string | null,
): Promise<void> {
  await run(
    db,
    `UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = ? WHERE id = ?`,
    lockUntilIso,
    userId,
  );
}

/** Personas con rol asignado (usado por la administración de usuarios). */
export interface UserAdminRow {
  id: number;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: number;
  must_change_password: number;
  locked_until: string | null;
  last_login_at: string | null;
  roles: string;
}

/**
 * Listado administrativo de usuarios.
 *
 * Incluye estado, bloqueo y último ingreso; los roles llegan como códigos
 * separados por comas y se convierten en lista en la capa que responde.
 */
export async function listUsersForAdmin(db: D1Database): Promise<UserAdminRow[]> {
  return all<UserAdminRow>(
    db,
    `SELECT u.id, u.username, u.email, u.display_name, u.is_active,
            u.must_change_password, u.locked_until, u.last_login_at,
            COALESCE(GROUP_CONCAT(r.code), '') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.archived_at IS NULL
      GROUP BY u.id
      ORDER BY u.username`,
  );
}

export async function findUserAdminRow(
  db: D1Database,
  id: number,
): Promise<UserAdminRow | null> {
  return first<UserAdminRow>(
    db,
    `SELECT u.id, u.username, u.email, u.display_name, u.is_active,
            u.must_change_password, u.locked_until, u.last_login_at,
            COALESCE(GROUP_CONCAT(r.code), '') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ? AND u.archived_at IS NULL
      GROUP BY u.id`,
    id,
  );
}

export async function updateUserProfile(
  db: D1Database,
  id: number,
  profile: { displayName: string | null; email: string | null },
): Promise<void> {
  await run(
    db,
    `UPDATE users SET display_name = ?, email = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    profile.displayName,
    profile.email,
    nowIso(),
    id,
  );
}

export async function setUserActive(db: D1Database, id: number, isActive: boolean): Promise<void> {
  await run(
    db,
    `UPDATE users SET is_active = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
    isActive ? 1 : 0,
    nowIso(),
    id,
  );
}

/** Reemplaza por completo los roles del usuario. */
export async function replaceUserRoles(
  db: D1Database,
  id: number,
  roleCodes: readonly string[],
): Promise<void> {
  const codes = [...new Set(roleCodes)];
  // Borrado y reinserción en un solo lote: o el usuario queda con su conjunto
  // nuevo de roles, o no se toca nada.
  await batch(db, [
    stmt(db, `DELETE FROM user_roles WHERE user_id = ?`, id),
    ...codes.map((code) =>
      stmt(
        db,
        `INSERT INTO user_roles (user_id, role_id)
           SELECT ?, id FROM roles WHERE code = ? AND archived_at IS NULL`,
        id,
        code,
      ),
    ),
  ]);
}

export async function unlockUser(db: D1Database, id: number): Promise<void> {
  await run(
    db,
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    nowIso(),
    id,
  );
}

/** Archiva la cuenta y cierra sus sesiones: deja de poder usarse. */
export async function archiveUserAccount(db: D1Database, id: number): Promise<void> {
  await run(
    db,
    `UPDATE users SET archived_at = ?, is_active = 0, updated_at = ?
      WHERE id = ? AND archived_at IS NULL`,
    nowIso(),
    nowIso(),
    id,
  );
  await run(db, `DELETE FROM sessions WHERE user_id = ?`, id);
}

/** Invalida las sesiones abiertas de un usuario. */
export async function deleteSessionsForUser(db: D1Database, id: number): Promise<void> {
  await run(db, `DELETE FROM sessions WHERE user_id = ?`, id);
}

/**
 * Administradores **activos** que quedan. Excluir a uno permite comprobar si
 * quitarle el rol o desactivarlo dejaría la instalación sin ningún
 * administrador con acceso.
 */
export async function countActiveAdmins(db: D1Database, excludeUserId?: number): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(DISTINCT u.id) AS total
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.archived_at IS NULL AND u.is_active = 1 AND r.code = 'admin'
        AND (? IS NULL OR u.id <> ?)`,
    excludeUserId ?? null,
    excludeUserId ?? null,
  );
  return row?.total ?? 0;
}
