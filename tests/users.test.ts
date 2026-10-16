import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ApiClient, seedUser } from './helpers';

const USERS = '/api/v1/users';

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

/** Cambia la contraseña obligatoria de una cuenta recién creada. */
async function changeOwnPassword(
  api: ApiClient,
  current: string,
  next: string,
): Promise<void> {
  const response = await api.request('POST', '/api/v1/auth/password', {
    body: { currentPassword: current, newPassword: next },
    csrf: true,
  });
  expect(response.status).toBe(200);
}

describe('gestión de usuarios', () => {
  it('lista usuarios y roles con los permisos que concede cada rol', async () => {
    const api = await adminClient();

    const response = await api.get<{
      users: { username: string; roles: string[] }[];
      roles: { code: string; permissions: string[] }[];
    }>(USERS);

    expect(response.status).toBe(200);
    expect(response.body.data?.users.some((u) => u.username === 'admin')).toBe(true);

    const adminRole = response.body.data?.roles.find((r) => r.code === 'admin');
    expect(adminRole?.permissions).toContain('users.write');
  });

  it('crea un usuario con roles y le obliga a cambiar la contraseña', async () => {
    const api = await adminClient();

    const created = await api.post<{ id: number }>(USERS, {
      username: 'guardia',
      displayName: 'Guardia Nocturna',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    expect(created.status).toBe(201);
    const id = created.body.data?.id ?? 0;

    const list = await api.get<{
      users: { id: number; mustChangePassword: boolean; roles: string[] }[];
    }>(USERS);
    const row = list.body.data?.users.find((u) => u.id === id);
    expect(row?.roles).toEqual(['viewer']);
    expect(row?.mustChangePassword).toBe(true);
  });

  it('rechaza un nombre de usuario repetido y una contraseña corta', async () => {
    const api = await adminClient();

    const first = await api.post(USERS, {
      username: 'guardia',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    expect(first.status).toBe(201);

    const duplicate = await api.post(USERS, {
      username: 'guardia',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    expect(duplicate.status).toBe(409);

    const short = await api.post(USERS, {
      username: 'corta',
      password: 'corta',
      roles: ['viewer'],
    });
    expect(short.status).toBe(422);
  });

  it('cambia los roles y el estado de una cuenta', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number }>(USERS, {
      username: 'guardia',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    const id = created.body.data?.id ?? 0;

    const updated = await api.put(`${USERS}/${id}`, {
      roles: ['inventory_manager'],
      isActive: false,
    });
    expect(updated.status).toBe(200);

    const list = await api.get<{ users: { id: number; isActive: boolean; roles: string[] }[] }>(
      USERS,
    );
    const row = list.body.data?.users.find((u) => u.id === id);
    expect(row?.isActive).toBe(false);
    expect(row?.roles).toEqual(['inventory_manager']);
  });

  it('no permite desactivarse ni quitarse el rol de administrador a uno mismo', async () => {
    const api = await adminClient();
    const me = await api.get<{ user: { id: number } }>('/api/v1/auth/me');
    const myId = me.body.data?.user.id ?? 0;

    const deactivate = await api.put(`${USERS}/${myId}`, { isActive: false });
    expect(deactivate.status).toBe(422);

    const demote = await api.put(`${USERS}/${myId}`, { roles: ['viewer'] });
    expect(demote.status).toBe(422);
  });

  it('no permite dejar la instalación sin ningún administrador activo', async () => {
    const api = await adminClient();
    const me = await api.get<{ user: { id: number } }>('/api/v1/auth/me');
    const adminId = me.body.data?.user.id ?? 0;

    // Se concede `users.write` al rol de consulta: así quien actúa NO es
    // administrador y el guardia de "no te quites tu propio admin" no se
    // adelanta, de modo que se prueba el guardia real.
    await env.DB.prepare(
      `INSERT INTO role_permissions (role_id, permission_code)
         SELECT id, 'users.write' FROM roles WHERE code = 'viewer'`,
    ).run();

    try {
      const created = await api.post<{ id: number }>(USERS, {
        username: 'gestor',
        password: 'ContrasenaLarga123',
        roles: ['viewer'],
      });
      expect(created.status).toBe(201);

      const gestor = new ApiClient();
      expect(await gestor.login('gestor', 'ContrasenaLarga123')).toBe(200);
      await changeOwnPassword(gestor, 'ContrasenaLarga123', 'ContrasenaLarga456');

      const demote = await gestor.put(`${USERS}/${adminId}`, { roles: ['viewer'] });
      expect(demote.status).toBe(422);

      const archive = await gestor.del(`${USERS}/${adminId}`);
      expect(archive.status).toBe(422);
    } finally {
      await env.DB.prepare(
        `DELETE FROM role_permissions
          WHERE permission_code = 'users.write'
            AND role_id = (SELECT id FROM roles WHERE code = 'viewer')`,
      ).run();
    }
  });

  it('restablece la contraseña, cierra las sesiones y vuelve a exigir el cambio', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number }>(USERS, {
      username: 'guardia',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    const id = created.body.data?.id ?? 0;

    const guardia = new ApiClient();
    expect(await guardia.login('guardia', 'ContrasenaLarga123')).toBe(200);
    await changeOwnPassword(guardia, 'ContrasenaLarga123', 'ContrasenaLarga456');
    expect((await guardia.get('/api/v1/auth/me')).status).toBe(200);

    const reset = await api.post(`${USERS}/${id}/password`, { password: 'OtraContrasena123' });
    expect(reset.status).toBe(200);

    // La sesión abierta deja de servir: quien tuviera la contraseña anterior
    // pierde el acceso.
    expect((await guardia.get('/api/v1/auth/me')).status).toBe(401);

    const relogin = new ApiClient();
    expect(await relogin.login('guardia', 'OtraContrasena123')).toBe(200);
    const me = await relogin.get<{ user: { mustChangePassword: boolean } }>('/api/v1/auth/me');
    expect(me.body.data?.user.mustChangePassword).toBe(true);
  });

  it('desbloquea una cuenta bloqueada por intentos fallidos', async () => {
    const api = await adminClient();
    const id = await seedUser('bloqueado', 'ContrasenaLarga123', 'viewer');

    await env.DB.prepare(`UPDATE users SET locked_until = ?, failed_attempts = 5 WHERE id = ?`)
      .bind(new Date(Date.now() + 600_000).toISOString(), id)
      .run();

    const before = await api.get<{ users: { id: number; locked: boolean }[] }>(USERS);
    expect(before.body.data?.users.find((u) => u.id === id)?.locked).toBe(true);

    const unlocked = await api.post(`${USERS}/${id}/unlock`);
    expect(unlocked.status).toBe(200);

    const after = await api.get<{ users: { id: number; locked: boolean }[] }>(USERS);
    expect(after.body.data?.users.find((u) => u.id === id)?.locked).toBe(false);
  });

  it('archiva una cuenta y le quita el acceso', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number }>(USERS, {
      username: 'guardia',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    const id = created.body.data?.id ?? 0;

    const archived = await api.del(`${USERS}/${id}`);
    expect(archived.status).toBe(200);

    const list = await api.get<{ users: { id: number }[] }>(USERS);
    expect(list.body.data?.users.some((u) => u.id === id)).toBe(false);

    const relogin = new ApiClient();
    expect(await relogin.login('guardia', 'ContrasenaLarga123')).toBe(401);
  });

  it('exige permiso para consultar y para gestionar usuarios', async () => {
    await seedUser('consulta', 'ContrasenaLarga123', 'viewer');
    const viewer = new ApiClient();
    expect(await viewer.login('consulta', 'ContrasenaLarga123')).toBe(200);

    expect((await viewer.get(USERS)).status).toBe(403);

    const create = await viewer.post(USERS, {
      username: 'colado',
      password: 'ContrasenaLarga123',
      roles: ['viewer'],
    });
    expect(create.status).toBe(403);
  });
});
