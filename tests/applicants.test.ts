import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { ApiClient, countRows, seedUser } from './helpers';

interface ApplicantDto {
  id: number;
  fullName: string;
  status: string;
  rut: string | null;
  personId: number | null;
}

interface SiteResponse {
  sections: { key: string; settings: Record<string, unknown> }[];
}

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

/** Publica la sección de postulación para poder probar el formulario. */
async function openApplications(api: ApiClient): Promise<void> {
  const saved = await api.put('/api/v1/site/sections/apply', {
    isEnabled: true,
    settings: { isOpen: true },
  });
  expect(saved.status).toBe(200);
}

/** Envía una postulación desde el sitio público (sin sesión). */
function submit(
  client: ApiClient,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { ok: boolean; error?: { code: string; message: string } } }> {
  return client.request('POST', '/api/v1/applications', {
    body: {
      fullName: 'Postulante Uno',
      rut: '12.345.678-5',
      email: 'uno@example.com',
      phone: '+56912345678',
      commune: 'Concepción',
      motivation: 'Quiero servir a la comunidad.',
      consent: true,
      ...overrides,
    },
  });
}

describe('postulaciones', () => {
  it('recibe una postulación anónima y le asigna el estado nuevo', async () => {
    await openApplications(await adminClient());
    const client = new ApiClient();
    const response = await submit(client);
    expect(response.status).toBe(201);
    // La respuesta es genérica: no revela si se guardó o se descartó.
    expect(response.body).toEqual({ ok: true, data: { received: true } });

    expect(await countRows('applicants')).toBe(1);
    const row = await env.DB.prepare(`SELECT full_name, status, rut, consent_at FROM applicants`).first<{
      full_name: string;
      status: string;
      rut: string;
      consent_at: string;
    }>();
    expect(row?.status).toBe('nuevo');
    expect(row?.rut).toBe('12345678-5');
    expect(row?.consent_at).toBeTruthy();
  });

  it('exige el consentimiento y no guarda sin él', async () => {
    await openApplications(await adminClient());
    const client = new ApiClient();
    const response = await submit(client, { consent: false });
    expect(response.status).toBe(422);
    expect(await countRows('applicants')).toBe(0);
  });

  it('descarta en silencio una postulación duplicada reciente', async () => {
    await openApplications(await adminClient());
    const client = new ApiClient();
    await submit(client);
    const second = await submit(client);
    expect(second.status).toBe(201);
    expect(await countRows('applicants')).toBe(1);
  });

  it('ignora a los robots que rellenan el campo trampa', async () => {
    await openApplications(await adminClient());
    const client = new ApiClient();
    const response = await submit(client, { website: 'http://spam.example' });
    expect(response.status).toBe(201);
    expect(await countRows('applicants')).toBe(0);
  });

  it('limita los envíos por conexión', async () => {
    await openApplications(await adminClient());
    const client = new ApiClient();
    for (let i = 0; i < 5; i += 1) {
      const response = await submit(client, {
        rut: '',
        email: `p${i}@example.com`,
      });
      expect(response.status).toBe(201);
    }
    const blocked = await submit(client, { rut: '', email: 'otro@example.com' });
    expect(blocked.status).toBe(429);
  });

  it('permite revisar, contactar y convertir a integrante', async () => {
    const api = await adminClient();
    await openApplications(api);

    const publicClient = new ApiClient();
    await submit(publicClient);

    const list = await api.get<{ applicants: ApplicantDto[] }>('/api/v1/applicants');
    expect(list.body.data?.applicants).toHaveLength(1);
    const applicant = list.body.data?.applicants[0];
    expect(applicant?.fullName).toBe('Postulante Uno');

    const id = applicant?.id ?? 0;

    // Nota interna y bitácora de contacto.
    const note = await api.post(`/api/v1/applicants/${id}/notes`, { body: 'Buena presentación.' });
    expect(note.status).toBe(201);
    const contact = await api.post(`/api/v1/applicants/${id}/contacts`, {
      channel: 'telefono',
      summary: 'Se llamó y quedó de traer certificados.',
    });
    expect(contact.status).toBe(201);

    const detail = await api.get<{
      applicant: ApplicantDto;
      notes: unknown[];
      contacts: unknown[];
    }>(`/api/v1/applicants/${id}`);
    expect(detail.body.data?.notes).toHaveLength(1);
    expect(detail.body.data?.contacts).toHaveLength(1);

    // Cambio de estado.
    const status = await api.put(`/api/v1/applicants/${id}/status`, { status: 'entrevista' });
    expect(status.status).toBe(200);

    // Conversión a ficha de integrante.
    const converted = await api.post<{ personId: number }>(`/api/v1/applicants/${id}/convert`);
    expect(converted.status).toBe(201);
    expect(await countRows('persons')).toBe(1);

    const again = await api.post(`/api/v1/applicants/${id}/convert`);
    expect(again.status).toBe(409);

    // Archivar la saca del listado sin borrarla.
    const archived = await api.del(`/api/v1/applicants/${id}`);
    expect(archived.status).toBe(200);
    const afterArchive = await api.get<{ applicants: ApplicantDto[] }>('/api/v1/applicants');
    expect(afterArchive.body.data?.applicants).toHaveLength(0);
    expect(await countRows('applicants', 'archived_at IS NOT NULL')).toBe(1);
  });

  it('exige permiso para leer y para gestionar', async () => {
    await seedUser('consulta', 'ContrasenaLarga123', 'viewer');
    const viewer = new ApiClient();
    await viewer.login('consulta', 'ContrasenaLarga123');

    expect((await viewer.get('/api/v1/applicants')).status).toBe(403);
    expect((await viewer.get('/api/v1/applicants/1')).status).toBe(403);
    expect((await viewer.put('/api/v1/applicants/1/status', { status: 'contactado' })).status).toBe(403);
  });

  it('rechaza el envío cuando la sección está cerrada o desactivada', async () => {
    const api = await adminClient();
    // Se parte de una sección desactivada (el estado persiste entre pruebas).
    await api.put('/api/v1/site/sections/apply', { isEnabled: false, settings: { isOpen: true } });
    const closed = await submit(new ApiClient());
    expect(closed.status).toBe(403);
    expect(await countRows('applicants')).toBe(0);

    // Publicada pero cerrada tampoco.
    await openApplications(api);
    await api.put('/api/v1/site/sections/apply', { isEnabled: true, settings: { isOpen: false } });
    const paused = await submit(new ApiClient());
    expect(paused.status).toBe(403);
    expect(await countRows('applicants')).toBe(0);
  });

  it('sanea el texto enriquecido de la sección al guardarla y al publicarla', async () => {
    const api = await adminClient();

    const saved = await api.put('/api/v1/site/sections/apply', {
      isEnabled: true,
      settings: {
        title: 'Postula',
        intro: '<p>Bienvenido</p>',
        requirements: '<h3>Requisitos</h3><ul><li>Ser mayor</li></ul><script>alert(1)</script>',
        isOpen: true,
        closedMessage: 'Cerrado',
        consentText: 'Autorizo.',
        successMessage: 'Recibido.',
      },
    });
    expect(saved.status).toBe(200);

    const site = await api.get<SiteResponse>('/api/v1/site');
    const apply = site.body.data?.sections.find((section) => section.key === 'apply');
    const requirements = String(apply?.settings.requirements ?? '');
    expect(requirements).toContain('<h3>Requisitos</h3>');
    expect(requirements).not.toContain('<script');

    // Una instalación que no la configure no publica la sección.
    await api.put('/api/v1/site/sections/apply', { isEnabled: false });
    const hidden = await api.get<SiteResponse>('/api/v1/site');
    expect(hidden.body.data?.sections.some((section) => section.key === 'apply')).toBe(false);
  });
});
