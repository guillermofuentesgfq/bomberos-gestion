import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { ApiClient, countRows, seedUser } from './helpers';
import { decryptSecret, encryptSecret } from '../src/worker/lib/secrets';
import { applicantMessage, notify } from '../src/worker/services/notifications';

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

/** Guarda el token y activa el canal a través de la API. */
async function enableChannel(api: ApiClient, token = '123456789:AAaaBBccDDeeFFggHHiiJJkkLLmmNNOOppQQ'): Promise<void> {
  const saved = await api.put('/api/v1/settings/notifications/telegram', {
    enabled: true,
    chatId: '-1001234567890',
    includeContact: false,
    token,
  });
  expect(saved.status).toBe(200);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notificaciones por Telegram', () => {
  it('cifra y descifra un secreto, y detecta una clave distinta', async () => {
    const secret = 'sesion-solo-para-pruebas-0123456789abcdef';
    const cipher = await encryptSecret('token-secreto', secret);
    expect(cipher).not.toContain('token-secreto');
    expect(await decryptSecret(cipher, secret)).toBe('token-secreto');
    // Otra clave (rotación) no puede descifrarlo: se devuelve null, no se lanza.
    expect(await decryptSecret(cipher, 'otra-clave-suficientemente-larga')).toBeNull();
    expect(await decryptSecret('no-es-base64-valido', secret)).toBeNull();
  });

  it('empieza desactivado y nunca devuelve el token', async () => {
    const api = await adminClient();
    const initial = await api.get<{ settings: { enabled: boolean; hasToken: boolean } }>(
      '/api/v1/settings/notifications/telegram',
    );
    expect(initial.body.data?.settings.enabled).toBe(false);
    expect(initial.body.data?.settings.hasToken).toBe(false);

    await enableChannel(api);

    const after = await api.get<{ settings: Record<string, unknown> }>(
      '/api/v1/settings/notifications/telegram',
    );
    const settings = after.body.data?.settings ?? {};
    expect(settings.enabled).toBe(true);
    expect(settings.hasToken).toBe(true);
    expect(settings.chatId).toBe('-1001234567890');
    // El token no aparece por ninguna parte de la respuesta.
    expect(JSON.stringify(after.body)).not.toContain('123456789:');
    expect(settings).not.toHaveProperty('token');
    expect(settings).not.toHaveProperty('secret');
  });

  it('exige el grupo y el token para activar', async () => {
    const api = await adminClient();
    const noChat = await api.put('/api/v1/settings/notifications/telegram', {
      enabled: true,
      chatId: '',
      includeContact: false,
      token: '123456789:AAaaBBccDDeeFFggHHiiJJkkLLmmNNOOppQQ',
    });
    expect(noChat.status).toBe(422);

    const noToken = await api.put('/api/v1/settings/notifications/telegram', {
      enabled: true,
      chatId: '-1001234567890',
      includeContact: false,
    });
    expect(noToken.status).toBe(422);
  });

  it('solo el permiso de escritura institucional puede configurarlo', async () => {
    await seedUser('inventario', 'ContrasenaLarga123', 'inventory_manager');
    const manager = new ApiClient();
    await manager.login('inventario', 'ContrasenaLarga123');

    const read = await manager.get('/api/v1/settings/notifications/telegram');
    expect(read.status).toBe(200);
    const write = await manager.put('/api/v1/settings/notifications/telegram', {
      enabled: false,
      chatId: '',
      includeContact: false,
    });
    expect(write.status).toBe(403);
  });

  it('no envía nada si el canal está desactivado', async () => {
    const sent = await notify(env, { event: 'applicant.created', text: 'hola' });
    expect(sent).toBe(false);
    expect(await countRows('notification_log')).toBe(0);
  });

  it('envía el aviso y registra el intento', async () => {
    const api = await adminClient();
    await enableChannel(api);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const sent = await notify(env, { event: 'applicant.created', text: 'Nueva postulación' });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(String(call[0])).toContain('/sendMessage');
    expect(JSON.parse(call[1].body)).toMatchObject({ chat_id: '-1001234567890' });

    const log = await env.DB.prepare(`SELECT status FROM notification_log`).all<{ status: string }>();
    expect(log.results.map((row) => row.status)).toEqual(['sent']);
  });

  it('un fallo de Telegram no lanza y deja el error sin el token', async () => {
    const api = await adminClient();
    await enableChannel(api);

    const token = '123456789:AAaaBBccDDeeFFggHHiiJJkkLLmmNNOOppQQ';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(`Bad Request: bot${token}/sendMessage failed`, { status: 400 }),
      ),
    );

    const sent = await notify(env, { event: 'applicant.created', text: 'x' });
    expect(sent).toBe(false);

    const row = await env.DB.prepare(
      `SELECT last_error FROM notification_channels WHERE channel = 'telegram'`,
    ).first<{ last_error: string | null }>();
    expect(row?.last_error).toBeTruthy();
    expect(row?.last_error ?? '').not.toContain(token);
    expect(row?.last_error ?? '').toContain('bot<token>');
  });

  it('borra el token y desactiva el canal', async () => {
    const api = await adminClient();
    await enableChannel(api);

    const cleared = await api.del('/api/v1/settings/notifications/telegram/token');
    expect(cleared.status).toBe(200);
    const settings = await api.get<{ settings: { enabled: boolean; hasToken: boolean } }>(
      '/api/v1/settings/notifications/telegram',
    );
    expect(settings.body.data?.settings.enabled).toBe(false);
    expect(settings.body.data?.settings.hasToken).toBe(false);
  });

  it('construye el aviso con nombre y comuna y solo el contacto si se pide', () => {
    const input = {
      fullName: 'Ana Pérez',
      commune: 'Concepción',
      email: 'ana@example.com',
      phone: '+56912345678',
      motivation: 'Quiero postular.',
      applicantId: 7,
      origin: 'https://bomberos.example',
    };
    const withoutContact = applicantMessage(input, false);
    expect(withoutContact).toContain('Ana Pérez');
    expect(withoutContact).toContain('Concepción');
    expect(withoutContact).not.toContain('ana@example.com');
    expect(withoutContact).toContain('https://bomberos.example/admin/postulantes/7');

    const withContact = applicantMessage(input, true);
    expect(withContact).toContain('ana@example.com');
    expect(withContact).toContain('+56912345678');
  });
});
