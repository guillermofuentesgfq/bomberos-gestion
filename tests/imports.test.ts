import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { ApiClient, countRows, seedUser, stockOf } from './helpers';
import { foldKey, normalizeRut, parseDate } from '../src/worker/services/imports';

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

/** Catálogo mínimo: una ubicación y una categoría. */
async function seedCatalog(api: ApiClient): Promise<{ locationId: number; categoryId: number }> {
  const location = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', {
    name: 'Bodega',
  });
  const category = await api.post<{ id: number }>('/api/v1/inventory/catalog/categories', {
    name: 'Equipamiento',
  });
  return { locationId: location.body.data?.id ?? 0, categoryId: category.body.data?.id ?? 0 };
}

async function createBatch(api: ApiClient, kind: 'material' | 'person'): Promise<number> {
  const created = await api.post<{ id: number }>('/api/v1/imports', {
    kind,
    filename: kind === 'material' ? 'materiales.xlsx' : 'personas.xlsx',
  });
  expect(created.status).toBe(201);
  return created.body.data?.id ?? 0;
}

describe('importación masiva', () => {
  it('normaliza fechas, RUT y claves de catálogo', () => {
    expect(parseDate('12/03/1990')).toBe('1990-03-12');
    expect(parseDate('1990-03-12')).toBe('1990-03-12');
    expect(parseDate('31/02/1990')).toBeNull();
    // Serial de Excel para el 1 de enero de 2020.
    expect(parseDate('43831')).toBe('2020-01-01');
    expect(foldKey('  Bodegá  Principal ')).toBe('bodega principal');

    const valid = normalizeRut('12.345.678-5');
    expect('value' in valid && valid.value).toBe('12345678-5');
    const invalid = normalizeRut('12.345.678-9');
    expect('error' in invalid).toBe(true);
  });

  it('descarga las plantillas en Excel y CSV', async () => {
    const api = await adminClient();
    const xlsx = await api.request('GET', '/api/v1/imports/templates/material.xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect((xlsx.bytes?.byteLength ?? 0) > 500).toBe(true);

    const csv = await api.request('GET', '/api/v1/imports/templates/person.csv');
    expect(csv.status).toBe(200);
    const bytes = new Uint8Array(csv.bytes ?? new ArrayBuffer(0));
    // BOM UTF-8: sin él, Excel rompe los acentos.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('nombre_completo;rut');
  });

  it('importa materiales con existencias y las suma a lo que ya había', async () => {
    const api = await adminClient();
    const { locationId } = await seedCatalog(api);

    const batchId = await createBatch(api, 'material');
    const rows = await api.post(`/api/v1/imports/${batchId}/rows`, {
      rows: [
        {
          rowNo: 2,
          code: 'casco-01',
          name: 'Casco estructural',
          category: 'Equipamiento',
          location: 'Bodega',
          quantity: '4',
        },
        {
          rowNo: 3,
          code: 'CASCO-01',
          name: 'Casco estructural',
          location: 'Bodega',
          condition: 'En reparación',
          quantity: '2',
        },
      ],
    });
    expect(rows.status).toBe(200);

    const analysis = await api.get<{ batch: { valid: number; errors: number; total: number } }>(
      `/api/v1/imports/${batchId}`,
    );
    expect(analysis.body.data?.batch).toMatchObject({ total: 2, valid: 2, errors: 0 });

    const commit = await api.post<{ imported: number; stockRows: number }>(
      `/api/v1/imports/${batchId}/finalize`,
      { mode: 'all_or_nothing' },
    );
    expect(commit.status).toBe(200);
    expect(commit.body.data?.imported).toBe(1);

    const materials = await env.DB.prepare(
      `SELECT id, code FROM materials WHERE archived_at IS NULL`,
    ).all<{ id: number; code: string }>();
    expect(materials.results).toHaveLength(1);
    expect(materials.results[0]?.code).toBe('CASCO-01');

    const materialId = materials.results[0]?.id ?? 0;
    expect(await stockOf(materialId, locationId)).toBe(4);

    // Reimportar el mismo archivo no duplica: el código ya existe.
    const again = await createBatch(api, 'material');
    await api.post(`/api/v1/imports/${again}/rows`, {
      rows: [{ rowNo: 2, code: 'CASCO-01', name: 'Casco estructural', location: 'Bodega', quantity: '1' }],
    });
    const secondAnalysis = await api.get<{ batch: { errors: number } }>(`/api/v1/imports/${again}`);
    expect(secondAnalysis.body.data?.batch.errors).toBe(1);
    expect(await countRows('materials')).toBe(1);
  });

  it('en modo todo o nada no escribe nada si hay un error', async () => {
    const api = await adminClient();
    await seedCatalog(api);

    const batchId = await createBatch(api, 'material');
    await api.post(`/api/v1/imports/${batchId}/rows`, {
      rows: [
        { rowNo: 2, code: 'M-1', name: 'Válido', category: 'Equipamiento', location: 'Bodega', quantity: '1' },
        { rowNo: 3, code: 'M-2', name: 'Categoría mala', category: 'Inexistente' },
      ],
    });

    const strict = await api.post(`/api/v1/imports/${batchId}/finalize`, { mode: 'all_or_nothing' });
    expect(strict.status).toBe(422);
    expect(await countRows('materials')).toBe(0);

    const partial = await api.post<{ imported: number; skipped: number }>(
      `/api/v1/imports/${batchId}/finalize`,
      { mode: 'valid_only' },
    );
    expect(partial.status).toBe(200);
    expect(partial.body.data?.imported).toBe(1);
    expect(partial.body.data?.skipped).toBe(1);
    expect(await countRows('materials')).toBe(1);
  });

  it('genera el informe de errores descargable', async () => {
    const api = await adminClient();

    const batchId = await createBatch(api, 'material');
    await api.post(`/api/v1/imports/${batchId}/rows`, {
      rows: [{ rowNo: 2, code: '', name: '', location: 'Bodega', quantity: '1' }],
    });

    const report = await api.request('GET', `/api/v1/imports/${batchId}/report.xlsx`);
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toContain('spreadsheetml');
    expect((report.bytes?.byteLength ?? 0) > 500).toBe(true);
  });

  it('importa personas y rechaza RUT duplicados sin escribir', async () => {
    const api = await adminClient();

    const batchId = await createBatch(api, 'person');
    const rows = await api.post(`/api/v1/imports/${batchId}/rows`, {
      rows: [
        { rowNo: 2, fullName: 'Ana Pérez', rut: '12.345.678-5', quality: 'Activo', isActive: 'sí' },
        { rowNo: 3, fullName: 'Ana Pérez (repetida)', rut: '12345678-5' },
      ],
    });
    expect(rows.status).toBe(200);

    const analysis = await api.get<{ batch: { valid: number; errors: number }; issues: { code: string }[] }>(
      `/api/v1/imports/${batchId}`,
    );
    expect(analysis.body.data?.batch.errors).toBe(1);
    expect(analysis.body.data?.issues.some((issue) => issue.code === 'duplicate_in_file')).toBe(true);

    const partial = await api.post<{ imported: number }>(`/api/v1/imports/${batchId}/finalize`, {
      mode: 'valid_only',
    });
    expect(partial.body.data?.imported).toBe(1);
    expect(await countRows('persons')).toBe(1);
  });

  it('importa un cargo solo cuando hay RUT válido', async () => {
    const api = await adminClient();

    const batchId = await createBatch(api, 'person');
    await api.post(`/api/v1/imports/${batchId}/rows`, {
      rows: [
        { rowNo: 2, fullName: 'Con cargo', rut: '12.345.678-5', position: 'Capitán', joinDate: '01/02/2020' },
        { rowNo: 3, fullName: 'Sin RUT', position: 'Capitán' },
      ],
    });

    const detail = await api.get<{ batch: { errors: number }; issues: { code: string }[] }>(
      `/api/v1/imports/${batchId}`,
    );
    expect(detail.body.data?.batch.errors).toBe(1);
    expect(detail.body.data?.issues.some((issue) => issue.code === 'position_requires_rut')).toBe(true);
  });

  it('exige el permiso de importación del dominio', async () => {
    await seedUser('consulta', 'ContrasenaLarga123', 'viewer');
    const viewer = new ApiClient();
    await viewer.login('consulta', 'ContrasenaLarga123');

    const created = await viewer.post('/api/v1/imports', { kind: 'material' });
    expect(created.status).toBe(403);
    const template = await viewer.request('GET', '/api/v1/imports/templates/material.xlsx');
    expect(template.status).toBe(403);
  });
});
