import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { isUniqueViolation } from '../lib/sql';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../security/passwords';
import { logAudit } from '../security/audit';
import * as users from '../repositories/users';
import * as roles from '../repositories/roles';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Administración de usuarios y roles.
 *
 * Quién puede entrar a la plataforma y con qué roles. No se editan los permisos
 * de cada rol: eso viene de la migración de referencia y los roles se muestran
 * con lo que conceden, para saber qué se otorga al asignarlos.
 */
export const usersRoutes = new Hono<AppEnv>();

const idParam = z.coerce.number().int().positive();

function parseId(raw: string | undefined, label = 'usuario'): number {
  const parsed = idParam.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest(`${label} inválido.`);
  return parsed.data;
}

/**
 * El pepper es obligatorio para derivar contraseñas: sin él, aceptar el alta
 * daría por buena una credencial que luego no se podría verificar.
 */
function requirePepper(env: Env): string {
  const pepper = env.AUTH_PASSWORD_PEPPER;
  if (!pepper) throw AppError.internal('Falta configurar AUTH_PASSWORD_PEPPER en este entorno.');
  return pepper;
}

// Mismas reglas que la inicialización del primer administrador.
const usernameSchema = z
  .string()
  .trim()
  .min(3, 'El usuario debe tener al menos 3 caracteres.')
  .max(64, 'El usuario es demasiado largo.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo.');

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(256, 'La contraseña es demasiado larga.');

const roleCodesSchema = z.array(z.string().trim().min(1).max(40)).max(20);

const createUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email('Correo inválido.').max(160).nullable().optional(),
  password: passwordSchema,
  roles: roleCodesSchema,
});

const updateUserSchema = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email('Correo inválido.').max(160).nullable().optional(),
  isActive: z.boolean().optional(),
  roles: roleCodesSchema.optional(),
});

/** Separa la cadena de `GROUP_CONCAT` en una lista, sin entradas vacías. */
function toList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function userDto(row: users.UserAdminRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    // Bloqueada mientras el vencimiento siga en el futuro.
    locked: row.locked_until !== null && row.locked_until > new Date().toISOString(),
    lastLoginAt: row.last_login_at,
    roles: toList(row.roles),
  };
}

// --- Listado ----------------------------------------------------------------

usersRoutes.get('/', requireAuth, requirePermission('users.read'), async (c) => {
  const [rows, roleRows] = await Promise.all([
    users.listUsersForAdmin(c.env.DB),
    roles.listRolesWithPermissions(c.env.DB),
  ]);

  return ok(c, {
    users: rows.map(userDto),
    roles: roleRows.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      permissions: toList(row.permissions),
    })),
  });
});

// --- Alta -------------------------------------------------------------------

usersRoutes.post('/', requireAuth, requireCsrf, requirePermission('users.write'), async (c) => {
  const body = await readJson(c, createUserSchema);
  const actor = actorFrom(c);
  const db = c.env.DB;

  // El administrador elige una contraseña temporal: se obliga a cambiarla.
  const password = await hashPassword(body.password, requirePepper(c.env));

  let id: number;
  try {
    id = await users.insertUser(
      db,
      {
        username: body.username,
        email: body.email ?? null,
        displayName: body.displayName ?? null,
        password,
        mustChangePassword: true,
      },
      body.roles,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('Ya existe un usuario con ese nombre de usuario o correo.');
    }
    throw error;
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'users.created',
    entityType: 'user',
    entityId: id,
    detail: { username: body.username, roles: body.roles },
    ipHash: actor.ipHash,
  });

  return ok(c, { id }, 201);
});

// --- Edición ----------------------------------------------------------------

usersRoutes.put('/:id', requireAuth, requireCsrf, requirePermission('users.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await readJson(c, updateUserSchema);
  const actor = actorFrom(c);
  const db = c.env.DB;

  const target = await users.findUserAdminRow(db, id);
  if (!target) throw AppError.notFound('Usuario no encontrado.');

  const me = c.get('user');
  const isSelf = me !== null && me.id === id;

  // Nadie puede dejar su propia cuenta sin acceso.
  if (isSelf && body.isActive === false) {
    throw AppError.unprocessable('No puedes desactivar tu propia cuenta.');
  }
  if (isSelf && body.roles !== undefined && !body.roles.includes('admin')) {
    throw AppError.unprocessable('No puedes quitarte a ti mismo el rol de administrador.');
  }

  // Y la instalación no puede quedarse sin ningún administrador activo.
  const losesAdmin =
    (body.roles !== undefined && !body.roles.includes('admin')) || body.isActive === false;
  if (losesAdmin && target.roles.split(',').includes('admin') && target.is_active === 1) {
    if ((await users.countActiveAdmins(db, id)) === 0) {
      throw AppError.unprocessable(
        'Debe quedar al menos un administrador activo: asigna ese rol a otra cuenta antes de continuar.',
      );
    }
  }

  await users.updateUserProfile(db, id, {
    displayName: body.displayName === undefined ? target.display_name : body.displayName,
    email: body.email === undefined ? target.email : body.email,
  });
  if (body.roles !== undefined) await users.replaceUserRoles(db, id, body.roles);
  if (body.isActive !== undefined) await users.setUserActive(db, id, body.isActive);

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'users.updated',
    entityType: 'user',
    entityId: id,
    detail: { roles: body.roles, isActive: body.isActive },
    ipHash: actor.ipHash,
  });

  return ok(c, { updated: true });
});

// --- Contraseña, desbloqueo y baja ------------------------------------------

usersRoutes.post(
  '/:id/password',
  requireAuth,
  requireCsrf,
  requirePermission('users.write'),
  async (c) => {
    const id = parseId(c.req.param('id'));
    const body = await readJson(c, z.object({ password: passwordSchema }));
    const actor = actorFrom(c);
    const db = c.env.DB;

    const target = await users.findUserById(db, id);
    if (!target) throw AppError.notFound('Usuario no encontrado.');

    const password = await hashPassword(body.password, requirePepper(c.env));
    // Se obliga a cambiarla al entrar y se cierran las sesiones abiertas: quien
    // tuviera la contraseña anterior deja de tener acceso.
    await users.setPassword(db, id, password, true);
    await users.deleteSessionsForUser(db, id);

    await logAudit(db, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: 'users.password_reset',
      entityType: 'user',
      entityId: id,
      ipHash: actor.ipHash,
    });

    return ok(c, { updated: true });
  },
);

usersRoutes.post(
  '/:id/unlock',
  requireAuth,
  requireCsrf,
  requirePermission('users.write'),
  async (c) => {
    const id = parseId(c.req.param('id'));
    const actor = actorFrom(c);
    const db = c.env.DB;

    const target = await users.findUserById(db, id);
    if (!target) throw AppError.notFound('Usuario no encontrado.');

    await users.unlockUser(db, id);
    await logAudit(db, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: 'users.unlocked',
      entityType: 'user',
      entityId: id,
      ipHash: actor.ipHash,
    });

    return ok(c, { updated: true });
  },
);

usersRoutes.delete('/:id', requireAuth, requireCsrf, requirePermission('users.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  const actor = actorFrom(c);
  const db = c.env.DB;

  const me = c.get('user');
  if (me !== null && me.id === id) {
    throw AppError.unprocessable('No puedes archivar tu propia cuenta.');
  }

  const target = await users.findUserAdminRow(db, id);
  if (!target) throw AppError.notFound('Usuario no encontrado.');

  if (target.roles.split(',').includes('admin') && target.is_active === 1) {
    if ((await users.countActiveAdmins(db, id)) === 0) {
      throw AppError.unprocessable(
        'Debe quedar al menos un administrador activo: asigna ese rol a otra cuenta antes de continuar.',
      );
    }
  }

  await users.archiveUserAccount(db, id);
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'users.archived',
    entityType: 'user',
    entityId: id,
    detail: { username: target.username },
    ipHash: actor.ipHash,
  });

  return ok(c, { archived: true });
});
