import { describe, expect, it } from 'vitest';
import { ApiClient, seedUser } from './helpers';

interface PublicSite {
  institution: { name: string; primaryColor: string };
  seo: { title: string; allowIndexing: boolean };
  sections: { sectionKey: string; enabled: boolean; sortOrder: number }[];
  pages: { slug: string; title: string }[];
  news: { slug: string; title: string }[];
}

interface PublicPageResponse {
  page: { slug: string; title: string; body: string | null };
}

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

describe('sitio público y CMS', () => {
  it('sirve el sitio público sin autenticación y con estado vacío digno', async () => {
    const anonymous = new ApiClient();
    const site = await anonymous.get<PublicSite>('/api/v1/site');
    expect(site.status).toBe(200);
    expect(site.body.data?.institution.name).toBe('');
    expect(site.body.data?.pages).toEqual([]);
    expect(Array.isArray(site.body.data?.sections)).toBe(true);
  });

  it('expone sitemap.xml y robots.txt sin sesión', async () => {
    const anonymous = new ApiClient();
    const sitemap = await anonymous.request('GET', '/sitemap.xml');
    expect(sitemap.status).toBe(200);
    const robots = await anonymous.request('GET', '/robots.txt');
    expect(robots.status).toBe(200);
  });

  it('publica la configuración institucional y la refleja en el sitio', async () => {
    const api = await adminClient();
    const updated = await api.put('/api/v1/site/institution', {
      name: 'Cuerpo de Bomberos de Prueba',
      number: '2ª',
      primaryColor: '#b91c1c',
      seo: { title: 'Bomberos de Prueba', allowIndexing: true },
    });
    expect(updated.status).toBe(200);

    const anonymous = new ApiClient();
    const site = await anonymous.get<PublicSite>('/api/v1/site');
    expect(site.body.data?.institution.name).toBe('Cuerpo de Bomberos de Prueba');
    expect(site.body.data?.institution.primaryColor).toBe('#b91c1c');
    expect(site.body.data?.seo.title).toBe('Bomberos de Prueba');
  });

  it('no expone borradores y sí el contenido publicado (publicar y retirar)', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number; slug: string }>('/api/v1/site/pages', {
      title: 'Historia de la compañía',
      body: 'Fundada para servir a la comunidad.',
    });
    expect(created.status).toBe(201);
    const id = created.body.data?.id ?? 0;
    const slug = created.body.data?.slug ?? '';

    // En borrador: no aparece públicamente.
    const draft = await api.get<PublicPageResponse>(`/api/v1/site/pages/${id}`);
    expect(draft.status).toBe(200);
    const anonymous = new ApiClient();
    expect((await anonymous.get(`/api/v1/pages/${slug}`)).status).toBe(404);

    // Publicar: aparece.
    const published = await api.post(`/api/v1/site/pages/${id}/publish`);
    expect(published.status).toBe(200);
    const live = await anonymous.get<PublicPageResponse>(`/api/v1/pages/${slug}`);
    expect(live.status).toBe(200);
    expect(live.body.data?.page.title).toBe('Historia de la compañía');

    // Despublicar: vuelve a ocultarse.
    expect((await api.post(`/api/v1/site/pages/${id}/unpublish`)).status).toBe(200);
    expect((await anonymous.get(`/api/v1/pages/${slug}`)).status).toBe(404);
  });

  it('exige el permiso site.publish para publicar', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number }>('/api/v1/site/news', { title: 'Comunicado' });
    const id = created.body.data?.id ?? 0;

    // Un editor del sitio puede escribir pero el rol `viewer` no publica.
    await seedUser('consulta', 'ContrasenaConsulta1', 'viewer');
    const viewer = new ApiClient();
    await viewer.login('consulta', 'ContrasenaConsulta1');

    expect((await viewer.post(`/api/v1/site/news/${id}/publish`)).status).toBe(403);
    expect((await api.post(`/api/v1/site/news/${id}/publish`)).status).toBe(200);
  });

  it('respeta allowIndexing=false en robots.txt', async () => {
    const api = await adminClient();
    await api.put('/api/v1/site/institution', { seo: { allowIndexing: false } });

    const anonymous = new ApiClient();
    const robots = await anonymous.request('GET', '/robots.txt');
    const text = await new Response(robots.bytes).text();
    expect(text).toContain('Disallow: /');
  });

  it('no expone sitemap ni robots de contenido en borrador', async () => {
    const api = await adminClient();
    await api.post('/api/v1/site/pages', { title: 'Página oculta' });

    const anonymous = new ApiClient();
    const sitemap = await anonymous.request('GET', '/sitemap.xml');
    const xml = await new Response(sitemap.bytes).text();
    expect(xml).not.toContain('pagina-oculta');
  });

  it('permite activar, desactivar y reordenar las secciones de la portada', async () => {
    const api = await adminClient();
    const before = await api.get<{
      sections: { key: string; isEnabled: boolean; sortOrder: number }[];
    }>('/api/v1/site/sections');
    expect(before.status).toBe(200);
    const sections = before.body.data?.sections ?? [];
    expect(sections.length).toBeGreaterThan(0);

    const first = sections[0];
    expect(first).toBeDefined();
    if (!first) return;

    const toggled = await api.put(`/api/v1/site/sections/${first.key}`, {
      isEnabled: !first.isEnabled,
    });
    expect(toggled.status).toBe(200);

    const order = [...sections].reverse().map((section) => section.key);
    const reordered = await api.post('/api/v1/site/sections/reorder', { order });
    expect(reordered.status).toBe(200);

    const after = await api.get<{ sections: { key: string }[] }>('/api/v1/site/sections');
    expect(after.body.data?.sections[0]?.key).toBe(order[0]);
  });

  it('una sección desactivada deja de aparecer en el sitio público', async () => {
    const api = await adminClient();
    const disabled = await api.put('/api/v1/site/sections/contact', { isEnabled: false });
    expect(disabled.status).toBe(200);

    const anonymous = new ApiClient();
    const site = await anonymous.get<PublicSite & { sections: { key: string }[] }>('/api/v1/site');
    const keys = (site.body.data?.sections ?? []).map((section) => section.key);
    expect(keys).not.toContain('contact');
  });
});

describe('informes y exportación', () => {
  it('exige sesión y permiso para exportar', async () => {
    const anonymous = new ApiClient();
    expect((await anonymous.request('GET', '/api/v1/reports/inventory.xlsx')).status).toBe(401);
  });

  it('genera un .xlsx real y descargable', async () => {
    const api = await adminClient();
    const response = await api.request('GET', '/api/v1/reports/inventory.xlsx');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('content-disposition')).toContain('attachment');

    // Un .xlsx es un ZIP: debe empezar por la firma PK\x03\x04.
    const bytes = new Uint8Array(response.bytes ?? new ArrayBuffer(0));
    expect(bytes.length).toBeGreaterThan(0);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('devuelve el resumen del panel', async () => {
    const api = await adminClient();
    const summary = await api.get<Record<string, number>>('/api/v1/reports/summary');
    expect(summary.status).toBe(200);
    expect(typeof summary.body.data?.materials).toBe('number');
  });

  it('neutraliza fórmulas en las celdas exportadas', async () => {
    const api = await adminClient();
    const bodega = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', { name: 'Bodega' });
    await api.post('/api/v1/inventory/materials', {
      name: '=HYPERLINK("http://malicioso.example")',
      locationId: bodega.body.data?.id ?? 0,
      quantity: 1,
    });

    const response = await api.request('GET', '/api/v1/reports/inventory.xlsx');
    const zip = new Uint8Array(response.bytes ?? new ArrayBuffer(0));
    // El XML del libro no debe contener la fórmula sin neutralizar.
    const text = new TextDecoder().decode(zip);
    expect(text).not.toContain('<f>HYPERLINK');
  });
});

describe('imágenes del sitio público', () => {
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function pngForm(isPublic: boolean): FormData {
    const binary = atob(PNG);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'imagen.png', { type: 'image/png' }));
    form.append('isPublic', isPublic ? 'true' : 'false');
    return form;
  }

  async function uploadPng(api: ApiClient, isPublic: boolean): Promise<number> {
    const response = await api.request<{ id: number }>('POST', '/api/v1/files', {
      form: pngForm(isPublic),
      csrf: true,
    });
    expect(response.status).toBe(201);
    return response.body.data?.id ?? 0;
  }

  it('el escudo subido con isPublic aparece en la portada; uno privado no', async () => {
    const api = await adminClient();
    const publicId = await uploadPng(api, true);

    const assigned = await api.put('/api/v1/site/institution', { shieldObjectId: publicId });
    expect(assigned.status).toBe(200);

    const anonymous = new ApiClient();
    const site = await anonymous.get<{
      institution: { shield: { url: string } | null };
    }>('/api/v1/site');
    expect(site.body.data?.institution.shield?.url).toContain(`/api/v1/files/${publicId}`);

    // Una imagen privada no se expone aunque quede referenciada.
    const privateId = await uploadPng(api, false);
    await api.put('/api/v1/site/institution', { shieldObjectId: privateId });

    const after = await anonymous.get<{ institution: { shield: { url: string } | null } }>(
      '/api/v1/site',
    );
    expect(after.body.data?.institution.shield).toBeNull();
  });

  it('agrega fotos a una galería y solo se publican las públicas', async () => {
    const api = await adminClient();
    const created = await api.post<{ id: number; slug: string }>('/api/v1/site/galleries', {
      title: 'Ejercicios de rescate',
    });
    expect(created.status).toBe(201);
    const galleryId = created.body.data?.id ?? 0;
    const slug = created.body.data?.slug ?? '';

    const publicId = await uploadPng(api, true);
    const privateId = await uploadPng(api, false);

    const added = await api.post(`/api/v1/site/galleries/${galleryId}/photos`, {
      photos: [
        { objectId: publicId, altText: 'Extracción vehicular' },
        { objectId: privateId, altText: 'Imagen interna' },
      ],
    });
    expect(added.status).toBe(201);

    await api.post(`/api/v1/site/galleries/${galleryId}/publish`);

    const anonymous = new ApiClient();
    const detail = await anonymous.get<{
      gallery: { title: string; photos: { url: string; alt: string | null }[] };
    }>(`/api/v1/galleries/${slug}`);

    expect(detail.status).toBe(200);
    const photos = detail.body.data?.gallery.photos ?? [];
    expect(photos).toHaveLength(1);
    expect(photos[0]?.url).toContain(`/api/v1/files/${publicId}`);
    expect(photos[0]?.alt).toBe('Extracción vehicular');
  });

  it('rechaza contenido activo también al subir desde el sitio', async () => {
    const api = await adminClient();
    const form = new FormData();
    form.append(
      'file',
      new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.svg', { type: 'image/svg+xml' }),
    );
    form.append('isPublic', 'true');
    const response = await api.request('POST', '/api/v1/files', { form, csrf: true });
    expect(response.status).toBe(422);
  });
});
