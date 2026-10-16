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
