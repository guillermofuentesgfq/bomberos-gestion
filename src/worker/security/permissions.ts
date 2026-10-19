import { all } from '../lib/db';

/** Permisos granulares usados por la aplicación. */
export type PermissionCode =
  | 'institution.read'
  | 'institution.write'
  | 'users.read'
  | 'users.write'
  | 'roles.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'inventory.assign'
  | 'inventory.return'
  | 'inventory.transfer'
  | 'inventory.writeoff'
  | 'inventory.maintenance'
  | 'inventory.import'
  | 'inventory.export'
  | 'persons.read'
  | 'persons.write'
  | 'persons.import'
  | 'applicants.read'
  | 'applicants.write'
  | 'site.read'
  | 'site.write'
  | 'site.publish'
  | 'audit.read';

interface RoleRow {
  code: string;
}

interface PermissionRow {
  permission_code: string;
}

/** Carga los códigos de rol de un usuario. */
export async function loadUserRoles(db: D1Database, userId: number): Promise<string[]> {
  const rows = await all<RoleRow>(
    db,
    `SELECT r.code AS code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.archived_at IS NULL`,
    userId,
  );
  return rows.map((r) => r.code);
}

/** Carga los permisos efectivos de un usuario (unión de sus roles). */
export async function loadUserPermissions(
  db: D1Database,
  userId: number,
): Promise<string[]> {
  const rows = await all<PermissionRow>(
    db,
    `SELECT DISTINCT rp.permission_code AS permission_code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = ? AND r.archived_at IS NULL`,
    userId,
  );
  return rows.map((r) => r.permission_code);
}

/** ¿El conjunto de permisos incluye el permiso indicado? */
export function hasPermission(permissions: readonly string[], code: PermissionCode): boolean {
  return permissions.includes(code);
}

/** ¿El usuario tiene alguno de los permisos indicados? */
export function hasAnyPermission(
  permissions: readonly string[],
  codes: readonly PermissionCode[],
): boolean {
  return codes.some((code) => permissions.includes(code));
}
