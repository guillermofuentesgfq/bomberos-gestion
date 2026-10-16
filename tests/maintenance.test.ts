import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../src/worker/security/sessions';
import { purgeStaleData } from '../src/worker/services/maintenance';
import { countRows } from './helpers';

/** Fecha ISO desplazada N días hacia atrás. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Crea un usuario mínimo: las sesiones lo referencian con clave foránea. */
async function seedUserRow(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, password_iterations, password_algo, created_at, updated_at)
     VALUES (1, 'usuario-de-prueba', 'h', 's', 1, 'PBKDF2-SHA256+HMAC', ?, ?)`,
  )
    .bind(daysAgo(0), daysAgo(0))
    .run();
}

describe('limpieza de datos caducados', () => {
  it('borra lo viejo y conserva lo reciente', async () => {
    await seedUserRow();
    // Una sesión caducada hace tiempo, una revocada hace tiempo, una viva, un
    // intento de ingreso viejo, uno reciente, una reserva caducada y una viva.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, created_at, last_seen_at, expires_at, user_agent, ip_hash)
         VALUES ('vieja', 1, 'h', 'c', ?, ?, ?, null, null)`,
      ).bind(daysAgo(40), daysAgo(40), daysAgo(39)),
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip_hash)
         VALUES ('revocada', 1, 'h', 'c', ?, ?, ?, ?, null, null)`,
      ).bind(daysAgo(40), daysAgo(40), daysAgo(1), daysAgo(40)),
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, created_at, last_seen_at, expires_at, user_agent, ip_hash)
         VALUES ('viva', 1, 'h', 'c', ?, ?, ?, null, null)`,
      ).bind(daysAgo(1), daysAgo(1), daysAgo(-1)),
      env.DB.prepare(
        `INSERT INTO login_attempts (username, success, ip_hash, created_at) VALUES ('u', 0, 'i', ?)`,
      ).bind(daysAgo(40)),
      env.DB.prepare(
        `INSERT INTO login_attempts (username, success, ip_hash, created_at) VALUES ('u', 1, 'i', ?)`,
      ).bind(daysAgo(1)),
      env.DB.prepare(
        `INSERT INTO idempotency_keys (key, scope, user_id, created_at, expires_at) VALUES ('vieja', 'transfer', 1, ?, ?)`,
      ).bind(daysAgo(2), daysAgo(1)),
      env.DB.prepare(
        `INSERT INTO idempotency_keys (key, scope, user_id, created_at, expires_at) VALUES ('viva', 'transfer', 1, ?, ?)`,
      ).bind(daysAgo(0), daysAgo(-1)),
    ]);

    const summary = await purgeStaleData(env.DB);

    expect(summary.sessions).toBe(2);
    expect(summary.loginAttempts).toBe(1);
    expect(summary.idempotencyKeys).toBe(1);

    expect(await countRows('sessions')).toBe(1);
    expect(await countRows('sessions', "id = 'viva'")).toBe(1);
    expect(await countRows('login_attempts')).toBe(1);
    expect(await countRows('idempotency_keys')).toBe(1);
    expect(await countRows('idempotency_keys', "key = 'viva'")).toBe(1);
  });

  it('acota el user-agent que se guarda al crear la sesión', async () => {
    await seedUserRow();

    await createSession(env.DB, 1, 'A'.repeat(5_000), null);

    const row = await env.DB.prepare(
      `SELECT LENGTH(user_agent) AS largo FROM sessions LIMIT 1`,
    ).first<{ largo: number }>();
    expect(row?.largo).toBe(256);
  });
});
