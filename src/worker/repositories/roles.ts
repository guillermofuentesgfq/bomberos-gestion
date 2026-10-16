import { all } from '../lib/db';

export interface RoleAdminRow {
  code: string;
  name: string;
  description: string | null;
  permissions: string;
}

/**
 * Roles con los permisos que conceden.
 *
 * La administración de usuarios los muestra para que se vea qué se está
 * otorgando al asignar un rol. No se editan desde ahí: los roles son del
 * sistema y sus permisos vienen de la migración de referencia.
 */
export async function listRolesWithPermissions(db: D1Database): Promise<RoleAdminRow[]> {
  return all<RoleAdminRow>(
    db,
    `SELECT r.code, r.name, r.description,
            COALESCE(GROUP_CONCAT(rp.permission_code), '') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.archived_at IS NULL
      GROUP BY r.id
      ORDER BY r.name`,
  );
}
