import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ApiClient, countRows, seedUser } from './helpers';

describe('autenticación, sesiones y autorización', () => {
  it('la instalación recién creada pide inicialización', async () => {
    const api = new ApiClient();
    const status = await api.get<{ needsSetup: boolean; authenticated: boolean }>('/api/v1/auth/status');
    expect(status.status).toBe(200);
    expect(status.body.data?.needsSetup).toBe(true);
    expect(status.body.data?.authenticated).toBe(false);
  });

  it('rechaza la inicialización con un token inválido', async () => {
    const api = new ApiClient();
    const response = await api.request('POST', '/api/v1/auth/setup', {
      body: { token: 'token-equivocado', username: 'admin', password: 'ContrasenaAdmin123' },
    });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('forbidden');
  });

  it('rechaza un cuerpo que no se declara como JSON', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    // La forma de una petición cruzada desde un formulario de otro sitio:
    // `text/plain` con un cuerpo que parece JSON. El parser de Hono no mira el
    // tipo de contenido, así que la puerta es la comprobación propia.
    const response = await SELF.fetch('https://ejemplo/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ username: 'admin', password: 'ContrasenaAdmin123' }),
    });
    expect(response.status).toBe(415);
  });

  it('aplica el tope de cuerpo sobre los bytes recibidos, no sobre la cabecera', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    // Cuerpo enviado por streaming, sin `content-length`: el tope debe medirlo.
    const chunk = new TextEncoder().encode(`{"relleno":"${'x'.repeat(64 * 1024)}"}`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 40; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await SELF.fetch('https://ejemplo/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
  });

  it('inicializa el primer administrador y no permite repetirlo', async () => {
    const api = new ApiClient();
    await api.setupAdmin();
    const again = await api.request('POST', '/api/v1/auth/setup', {
      body: { token: 'token-de-pruebas', username: 'otro', password: 'ContrasenaAdmin123' },
    });
    expect(again.status).toBe(409);
  });

  it('rechaza contraseñas que no cumplen la longitud mínima (Zod 422)', async () => {
    const api = new ApiClient();
    const response = await api.request('POST', '/api/v1/auth/setup', {
      body: { token: 'token-de-pruebas', username: 'admin', password: 'corta' },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.issues?.[0]?.path).toBe('password');
  });

  it('exige sesión en los endpoints protegidos (401)', async () => {
    const api = new ApiClient();
    await api.setupAdmin();
    const anonymous = new ApiClient();
    const response = await anonymous.get('/api/v1/inventory/materials');
    expect(response.status).toBe(401);
  });

  it('exige token CSRF en las operaciones con estado (403 sin token, 200 con token)', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    // Sin CSRF: se envía la cookie pero no la cabecera.
    const withoutCsrf = await api.request('POST', '/api/v1/inventory/catalog/locations', {
      body: { name: 'Bodega' },
    });
    expect(withoutCsrf.status).toBe(403);

    // Con CSRF: se usa el token obtenido en el setup.
    const withCsrf = await api.post('/api/v1/inventory/catalog/locations', { name: 'Bodega' });
    expect(withCsrf.status).toBe(201);
  });

  it('registra el fallo de autenticación sin revelar si el usuario existe', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    const missingUser = new ApiClient();
    expect(await missingUser.login('no-existe', 'ContrasenaAdmin123')).toBe(401);

    const wrongPassword = new ApiClient();
    expect(await wrongPassword.login('admin', 'ContrasenaIncorrecta1')).toBe(401);

    expect(await countRows('audit_log', "action = 'auth.login_failed'")).toBe(1);
  });

  it('bloquea la cuenta tras varios intentos fallidos', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    const attacker = new ApiClient();
    for (let intento = 0; intento < 5; intento += 1) {
      await attacker.login('admin', 'ContrasenaIncorrecta1');
    }
    // El siguiente intento, incluso con la contraseña correcta, está bloqueado.
    const blocked = await attacker.login('admin', 'ContrasenaAdmin123');
    expect(blocked).toBe(429);

    const locked = await env.DB.prepare(`SELECT locked_until FROM users WHERE username = 'admin'`)
      .first<{ locked_until: string | null }>();
    expect(locked?.locked_until).not.toBeNull();
  });

  it('revoca la sesión al cerrar sesión', async () => {
    const api = new ApiClient();
    await api.setupAdmin();
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    expect((await api.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
    expect(await countRows('sessions', 'revoked_at IS NOT NULL')).toBe(1);
  });

  it('niega por permisos a un usuario de solo consulta (403)', async () => {
    const admin = new ApiClient();
    await admin.setupAdmin();
    await seedUser('consulta', 'ContrasenaConsulta1', 'viewer');

    const viewer = new ApiClient();
    expect(await viewer.login('consulta', 'ContrasenaConsulta1')).toBe(200);

    // Puede leer inventario.
    expect((await viewer.get('/api/v1/inventory/materials')).status).toBe(200);
    // No puede crear ubicaciones.
    const denied = await viewer.post('/api/v1/inventory/catalog/locations', { name: 'Bodega' });
    expect(denied.status).toBe(403);
  });

  it('no permite cambiar la contraseña sin CSRF ni con la contraseña actual incorrecta', async () => {
    const api = new ApiClient();
    await api.setupAdmin();

    const withoutCsrf = await api.request('POST', '/api/v1/auth/password', {
      body: { currentPassword: 'ContrasenaAdmin123', newPassword: 'NuevaContrasena123' },
    });
    expect(withoutCsrf.status).toBe(403);

    const wrongCurrent = await api.post('/api/v1/auth/password', {
      currentPassword: 'NoEsLaActual1',
      newPassword: 'NuevaContrasena123',
    });
    expect(wrongCurrent.status).toBe(403);

    const ok = await api.post('/api/v1/auth/password', {
      currentPassword: 'ContrasenaAdmin123',
      newPassword: 'NuevaContrasena123',
    });
    expect(ok.status).toBe(200);
  });
});
