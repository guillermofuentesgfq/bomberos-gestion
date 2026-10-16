import { describe, expect, it } from 'vitest';
import { ApiClient, countRows, stockOf } from './helpers';

interface Setup {
  api: ApiClient;
  bodegaId: number;
  salaId: number;
  materialId: number;
  personId: number;
}

/** Inicializa la instalación, el catálogo, un material con stock y una persona. */
async function bootstrap(stock = 4): Promise<Setup> {
  const api = new ApiClient();
  await api.setupAdmin();

  const bodega = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', { name: 'Bodega' });
  const sala = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', { name: 'Sala' });
  await api.post('/api/v1/inventory/catalog/categories', { name: 'EPP' });

  const bodegaId = bodega.body.data?.id ?? 0;
  const salaId = sala.body.data?.id ?? 0;

  const material = await api.post<{ id: number }>('/api/v1/inventory/materials', {
    name: 'Casco estructural',
    locationId: bodegaId,
    conditionCode: 'operativo',
    quantity: stock,
    minStock: 1,
  });
  const materialId = material.body.data?.id ?? 0;

  const person = await api.post<{ id: number }>('/api/v1/persons', {
    fullName: 'Integrante de Prueba',
    rut: '11.111.111-1',
  });

  return { api, bodegaId, salaId, materialId, personId: person.body.data?.id ?? 0 };
}

describe('integridad del inventario', () => {
  it('crea material con existencias iniciales y las refleja', async () => {
    const { api, materialId, bodegaId } = await bootstrap(4);
    expect(await stockOf(materialId, bodegaId)).toBe(4);

    const detail = await api.get<{ stock: { quantity: number }[] }>(`/api/v1/inventory/materials/${materialId}`);
    expect(detail.body.data?.stock[0]?.quantity).toBe(4);
  });

  it('impide sobregirar las existencias en un traslado y no deja estado parcial', async () => {
    const { api, materialId, bodegaId, salaId } = await bootstrap(3);

    const ok = await api.post('/api/v1/inventory/transfers', {
      materialId,
      fromLocationId: bodegaId,
      toLocationId: salaId,
      conditionCode: 'operativo',
      quantity: 3,
    });
    expect(ok.status).toBe(201);
    expect(await stockOf(materialId, salaId)).toBe(3);
    expect(await stockOf(materialId, bodegaId)).toBe(0);

    const overdraft = await api.post('/api/v1/inventory/transfers', {
      materialId,
      fromLocationId: bodegaId,
      toLocationId: salaId,
      conditionCode: 'operativo',
      quantity: 1,
    });
    expect(overdraft.status).toBe(422);

    // Sin efecto parcial: el destino no cambió y no se registró el traslado.
    expect(await stockOf(materialId, salaId)).toBe(3);
    expect(await countRows('transfers')).toBe(1);
  });

  it('impide entregar más material del disponible', async () => {
    const { api, materialId, bodegaId, personId } = await bootstrap(2);

    const overdraft = await api.post(`/api/v1/persons/${personId}/assignments`, {
      deliveredBy: 'Capitán',
      lines: [{ materialId, locationId: bodegaId, quantity: 5 }],
    });
    expect(overdraft.status).toBe(422);

    // Nada se descontó ni se creó asignación.
    expect(await stockOf(materialId, bodegaId)).toBe(2);
    expect(await countRows('assignment_lines')).toBe(0);
    expect(await countRows('assignments')).toBe(0);
  });

  it('registra entregas y devoluciones parciales sin perder trazabilidad', async () => {
    const { api, materialId, bodegaId, salaId, personId } = await bootstrap(4);

    const assigned = await api.post<{ batchId: string }>(`/api/v1/persons/${personId}/assignments`, {
      deliveredBy: 'Capitán',
      lines: [{ materialId, locationId: bodegaId, quantity: 3, conditionOut: 'Buen estado' }],
    });
    expect(assigned.status).toBe(201);
    expect(await stockOf(materialId, bodegaId)).toBe(1);

    const detail = await api.get<{ assignments: { id: number; quantity: number; returned_qty: number }[] }>(
      `/api/v1/persons/${personId}`,
    );
    const line = detail.body.data?.assignments[0];
    expect(line?.quantity).toBe(3);
    expect(line?.returned_qty).toBe(0);

    const partial = await api.post(`/api/v1/persons/${personId}/returns`, {
      receivedBy: 'Capitán',
      toLocationId: salaId,
      conditionCode: 'operativo',
      lines: [{ assignmentLineId: line?.id ?? 0, quantity: 2 }],
    });
    expect(partial.status).toBe(201);
    expect(await stockOf(materialId, salaId)).toBe(2);
    expect(await stockOf(materialId, bodegaId)).toBe(1);

    const after = await api.get<{ assignments: { quantity: number; returned_qty: number }[] }>(
      `/api/v1/persons/${personId}`,
    );
    expect(after.body.data?.assignments[0]?.returned_qty).toBe(2);
  });

  it('rechaza devolver más de lo pendiente', async () => {
    const { api, materialId, bodegaId, salaId, personId } = await bootstrap(3);

    await api.post(`/api/v1/persons/${personId}/assignments`, {
      deliveredBy: 'Capitán',
      lines: [{ materialId, locationId: bodegaId, quantity: 2 }],
    });
    const detail = await api.get<{ assignments: { id: number }[] }>(`/api/v1/persons/${personId}`);
    const lineId = detail.body.data?.assignments[0]?.id ?? 0;

    const excess = await api.post(`/api/v1/persons/${personId}/returns`, {
      receivedBy: 'Capitán',
      toLocationId: salaId,
      conditionCode: 'operativo',
      lines: [{ assignmentLineId: lineId, quantity: 3 }],
    });
    expect(excess.status).toBe(422);
    expect(await countRows('returns')).toBe(0);
    expect(await stockOf(materialId, salaId)).toBe(0);
  });

  it('es idempotente: repetir la misma baja no duplica el efecto', async () => {
    const { api, materialId, bodegaId } = await bootstrap(5);
    const key = 'baja-idempotente-0001';

    const first = await api.post(
      '/api/v1/inventory/writeoffs',
      { materialId, locationId: bodegaId, conditionCode: 'operativo', quantity: 2, reason: 'Daño irreparable', authorizedBy: 'Capitán' },
      { idempotencyKey: key },
    );
    expect(first.status).toBe(201);
    const afterFirst = await stockOf(materialId, bodegaId);
    expect(afterFirst).toBe(3);

    const second = await api.post(
      '/api/v1/inventory/writeoffs',
      { materialId, locationId: bodegaId, conditionCode: 'operativo', quantity: 2, reason: 'Daño irreparable', authorizedBy: 'Capitán' },
      { idempotencyKey: key },
    );
    expect(second.status).toBe(200);
    expect(await stockOf(materialId, bodegaId)).toBe(afterFirst);
    expect(await countRows('writeoffs')).toBe(1);
    expect(await countRows('movements', "movement_type = 'baja'")).toBe(1);
  });

  it('no es vulnerable a inyección SQL en los filtros de búsqueda', async () => {
    const { api } = await bootstrap(1);
    const injected = await api.get(
      `/api/v1/inventory/materials?q=${encodeURIComponent("' OR 1=1; DROP TABLE materials;--")}`,
    );
    expect(injected.status).toBe(200);
    expect(injected.body.data).toEqual([]);
    // La tabla sigue existiendo y con su contenido.
    expect(await countRows('materials')).toBe(1);
  });

  it('rechaza códigos de material duplicados', async () => {
    const { api } = await bootstrap(1);
    const first = await api.post('/api/v1/inventory/materials', { name: 'Chaqueta', code: 'CHA-001' });
    expect(first.status).toBe(201);
    const duplicate = await api.post('/api/v1/inventory/materials', { name: 'Chaqueta', code: 'CHA-001' });
    expect(duplicate.status).toBe(409);
  });

  it('no permite sobregirar existencias con traslados simultáneos', async () => {
    // 5 unidades disponibles y 5 traslados simultáneos de 2: solo 2 pueden
    // completarse (4 unidades). Ninguno debe dejar existencias negativas.
    const { api, materialId, bodegaId, salaId } = await bootstrap(5);

    const attempts = Array.from({ length: 5 }, () =>
      api.post('/api/v1/inventory/transfers', {
        materialId,
        fromLocationId: bodegaId,
        toLocationId: salaId,
        conditionCode: 'operativo',
        quantity: 2,
      }),
    );
    const results = await Promise.all(attempts);

    const completed = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    expect(completed).toBe(2);
    expect(rejected).toBe(3);

    const origin = await stockOf(materialId, bodegaId);
    const destination = await stockOf(materialId, salaId);
    expect(origin).toBeGreaterThanOrEqual(0);
    expect(origin + destination).toBe(5);
    expect(destination).toBe(4);
    expect(await countRows('transfers')).toBe(2);
  });
});
