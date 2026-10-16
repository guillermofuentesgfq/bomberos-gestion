import { describe, expect, it } from 'vitest';
import { ApiClient, countRows, seedUser, stockOf } from './helpers';

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

  it('libera la clave de idempotencia cuando la operación falla', async () => {
    const { api, materialId, bodegaId } = await bootstrap(1);
    const key = 'clave-fallida';

    // Una baja mayor que las existencias se rechaza…
    const failed = await api.post(
      '/api/v1/inventory/writeoffs',
      { materialId, locationId: bodegaId, conditionCode: 'operativo', quantity: 5, reason: 'Daño irreparable', authorizedBy: 'Capitán' },
      { idempotencyKey: key },
    );
    expect(failed.status).toBe(422);

    // …y la misma clave puede reintentarse (no queda «envenenada»).
    const retried = await api.post(
      '/api/v1/inventory/writeoffs',
      { materialId, locationId: bodegaId, conditionCode: 'operativo', quantity: 1, reason: 'Daño irreparable', authorizedBy: 'Capitán' },
      { idempotencyKey: key },
    );
    expect(retried.status).toBe(201);
    expect(await stockOf(materialId, bodegaId)).toBe(0);
  });

  it('no re-entrega a otro titular la respuesta de una clave de idempotencia', async () => {
    const { api, materialId, bodegaId, salaId } = await bootstrap(4);
    await seedUser('operador-dos', 'ContrasenaLarga123', 'inventory_manager');
    const other = new ApiClient();
    expect(await other.login('operador-dos', 'ContrasenaLarga123')).toBe(200);

    const key = 'clave-cruzada';
    const first = await api.post(
      '/api/v1/inventory/transfers',
      { materialId, fromLocationId: bodegaId, toLocationId: salaId, conditionCode: 'operativo', quantity: 1 },
      { idempotencyKey: key },
    );
    expect(first.status).toBe(201);

    // Otro titular con la misma clave no recibe la respuesta ajena ni su
    // operación se omite en silencio.
    const foreign = await other.post(
      '/api/v1/inventory/transfers',
      { materialId, fromLocationId: bodegaId, toLocationId: salaId, conditionCode: 'operativo', quantity: 1 },
      { idempotencyKey: key },
    );
    expect(foreign.status).toBe(409);
    expect(await countRows('transfers')).toBe(1);
  });

  it('no acuña existencias ni registra bajas fantasma si la fila de origen no existe', async () => {
    const api = new ApiClient();
    await api.setupAdmin();
    const bodega = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', { name: 'Bodega' });
    const sala = await api.post<{ id: number }>('/api/v1/inventory/catalog/locations', { name: 'Sala' });
    const bodegaId = bodega.body.data?.id ?? 0;
    const salaId = sala.body.data?.id ?? 0;
    // Material creado sin existencias: no tiene fila en stock_levels.
    const material = await api.post<{ id: number }>('/api/v1/inventory/materials', { name: 'Sin existencias' });
    const materialId = material.body.data?.id ?? 0;

    const transfer = await api.post('/api/v1/inventory/transfers', {
      materialId,
      fromLocationId: bodegaId,
      toLocationId: salaId,
      conditionCode: 'operativo',
      quantity: 5,
    });
    expect(transfer.status).toBe(422);
    expect(await stockOf(materialId, salaId)).toBe(0);
    expect(await countRows('transfers')).toBe(0);

    const writeoff = await api.post('/api/v1/inventory/writeoffs', {
      materialId,
      locationId: salaId,
      conditionCode: 'operativo',
      quantity: 1,
      reason: 'Daño irreparable',
      authorizedBy: 'Capitán',
    });
    expect(writeoff.status).toBe(422);
    expect(await countRows('writeoffs')).toBe(0);
  });

  it('no es vulnerable a inyección SQL en los filtros de búsqueda', async () => {    const { api } = await bootstrap(1);
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

describe('edición de materiales y catálogo', () => {
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function uploadPrivatePhoto(api: ApiClient): Promise<number> {
    const binary = atob(PNG);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'casco.png', { type: 'image/png' }));
    form.append('isPublic', 'false');
    form.append('scope', 'inventory');
    const response = await api.request<{ id: number }>('POST', '/api/v1/files', {
      form,
      csrf: true,
    });
    expect(response.status).toBe(201);
    return response.body.data?.id ?? 0;
  }

  it('actualiza los campos editables y conserva los que no se envían', async () => {
    const { api, materialId } = await bootstrap(2);

    const before = await api.get<{ material: { code: string } }>(
      `/api/v1/inventory/materials/${materialId}`,
    );
    const originalCode = before.body.data?.material.code ?? '';

    const updated = await api.put<{ material: { name: string; minStock: number; notes: string | null } }>(
      `/api/v1/inventory/materials/${materialId}`,
      { name: 'Casco F1', minStock: 5, notes: 'Revisado en 2026' },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data?.material.name).toBe('Casco F1');
    expect(updated.body.data?.material.minStock).toBe(5);

    const after = await api.get<{
      material: { code: string; name: string; notes: string | null; min_stock: number };
    }>(`/api/v1/inventory/materials/${materialId}`);
    expect(after.body.data?.material.code).toBe(originalCode);
    expect(after.body.data?.material.notes).toBe('Revisado en 2026');
  });

  it('rechaza un código ya usado por otro material', async () => {
    const { api, materialId } = await bootstrap(1);
    await api.post('/api/v1/inventory/materials', { name: 'Guante de rescate', code: 'GUA-1' });

    const conflict = await api.put(`/api/v1/inventory/materials/${materialId}`, { code: 'gua-1' });
    expect(conflict.status).toBe(409);
  });

  it('asigna y quita la foto del material', async () => {
    const { api, materialId } = await bootstrap(1);
    const objectId = await uploadPrivatePhoto(api);

    const assigned = await api.put<{ material: { photoObjectId: number | null } }>(
      `/api/v1/inventory/materials/${materialId}`,
      { photoObjectId: objectId },
    );
    expect(assigned.status).toBe(200);
    expect(assigned.body.data?.material.photoObjectId).toBe(objectId);

    const detail = await api.get<{ material: { photo_object_id: number | null } }>(
      `/api/v1/inventory/materials/${materialId}`,
    );
    expect(detail.body.data?.material.photo_object_id).toBe(objectId);

    const listed = await api.get<{ id: number; photoObjectId: number | null }[]>(
      '/api/v1/inventory/materials',
    );
    expect(listed.body.data?.find((item) => item.id === materialId)?.photoObjectId).toBe(objectId);

    const cleared = await api.put<{ material: { photoObjectId: number | null } }>(
      `/api/v1/inventory/materials/${materialId}`,
      { photoObjectId: null },
    );
    expect(cleared.body.data?.material.photoObjectId).toBeNull();
  });

  it('guarda la foto también al crear el material', async () => {
    const { api } = await bootstrap(1);
    const objectId = await uploadPrivatePhoto(api);

    const created = await api.post<{ id: number }>('/api/v1/inventory/materials', {
      name: 'Pértiga',
      photoObjectId: objectId,
    });
    expect(created.status).toBe(201);

    const detail = await api.get<{ material: { photo_object_id: number | null } }>(
      `/api/v1/inventory/materials/${created.body.data?.id ?? 0}`,
    );
    expect(detail.body.data?.material.photo_object_id).toBe(objectId);
  });

  it('crea tipos de material y archiva ubicaciones sin borrarlas', async () => {
    const { api, bodegaId } = await bootstrap(1);

    const type = await api.post<{ id: number }>('/api/v1/inventory/catalog/material-types', {
      name: 'Cascos',
    });
    expect(type.status).toBe(201);

    const catalog = await api.get<{ materialTypes: { name: string }[] }>(
      '/api/v1/inventory/catalog',
    );
    expect(catalog.body.data?.materialTypes.some((entry) => entry.name === 'Cascos')).toBe(true);

    const archived = await api.del(`/api/v1/inventory/catalog/locations/${bodegaId}`);
    expect(archived.status).toBe(200);
    expect(await countRows('locations', 'id = ? AND archived_at IS NULL', bodegaId)).toBe(0);
    // La fila sigue existiendo: se archiva, no se borra.
    expect(await countRows('locations', 'id = ?', bodegaId)).toBe(1);
  });

  it('exige permiso de escritura para editar un material', async () => {
    const { api, materialId } = await bootstrap(1);
    await seedUser('consulta', 'ContrasenaLarga123', 'viewer');

    const viewer = new ApiClient();
    const login = await viewer.login('consulta', 'ContrasenaLarga123');
    expect(login).toBe(200);

    const denied = await viewer.put(`/api/v1/inventory/materials/${materialId}`, {
      name: 'Intento sin permiso',
    });
    expect(denied.status).toBe(403);
  });

  it('edita una ubicación: nombre y descripción', async () => {
    const { api, bodegaId } = await bootstrap(1);

    const before = await api.get<{ locations: { id: number; name: string; description: string | null }[] }>(
      '/api/v1/inventory/catalog',
    );
    expect(before.body.data?.locations.find((l) => l.id === bodegaId)?.name).toBe('Bodega');

    const renamed = await api.put(`/api/v1/inventory/catalog/locations/${bodegaId}`, {
      name: 'Bodega central',
      description: 'Piso 1, sector norte',
    });
    expect(renamed.status).toBe(200);

    const after = await api.get<{ locations: { id: number; name: string; description: string | null }[] }>(
      '/api/v1/inventory/catalog',
    );
    const row = after.body.data?.locations.find((l) => l.id === bodegaId);
    expect(row?.name).toBe('Bodega central');
    expect(row?.description).toBe('Piso 1, sector norte');
  });

  it('renombra categorías y rechaza nombres repetidos', async () => {
    const { api } = await bootstrap(1);

    const catalog = await api.get<{ categories: { id: number; name: string }[] }>(
      '/api/v1/inventory/catalog',
    );
    const categoryId = catalog.body.data?.categories[0]?.id ?? 0;
    expect(categoryId).toBeGreaterThan(0);

    const renamed = await api.put(`/api/v1/inventory/catalog/categories/${categoryId}`, {
      name: 'Equipo de protección personal',
    });
    expect(renamed.status).toBe(200);

    const after = await api.get<{ categories: { id: number; name: string }[] }>(
      '/api/v1/inventory/catalog',
    );
    expect(after.body.data?.categories.find((c) => c.id === categoryId)?.name).toBe(
      'Equipo de protección personal',
    );

    await api.post('/api/v1/inventory/catalog/categories', { name: 'Otra categoría' });
    const conflict = await api.put(`/api/v1/inventory/catalog/categories/${categoryId}`, {
      name: 'Otra categoría',
    });
    expect(conflict.status).toBe(409);
  });

  it('edita un tipo de material y lo asocia a una categoría', async () => {
    const { api } = await bootstrap(1);

    const catalog = await api.get<{ categories: { id: number }[] }>('/api/v1/inventory/catalog');
    const categoryId = catalog.body.data?.categories[0]?.id ?? 0;

    const created = await api.post<{ id: number }>('/api/v1/inventory/catalog/material-types', {
      name: 'Cascos',
    });
    const typeId = created.body.data?.id ?? 0;
    expect(typeId).toBeGreaterThan(0);

    const edited = await api.put(`/api/v1/inventory/catalog/material-types/${typeId}`, {
      name: 'Cascos estructurales',
      categoryId,
    });
    expect(edited.status).toBe(200);

    const after = await api.get<{
      materialTypes: { id: number; name: string; category_id: number | null }[];
    }>('/api/v1/inventory/catalog');
    const row = after.body.data?.materialTypes.find((t) => t.id === typeId);
    expect(row?.name).toBe('Cascos estructurales');
    expect(row?.category_id).toBe(categoryId);
  });

  it('responde 404 al editar una entrada que no existe', async () => {
    const { api } = await bootstrap(1);

    const location = await api.put('/api/v1/inventory/catalog/locations/9999', { name: 'Fantasma' });
    expect(location.status).toBe(404);

    const category = await api.put('/api/v1/inventory/catalog/categories/9999', { name: 'Fantasma' });
    expect(category.status).toBe(404);

    const type = await api.put('/api/v1/inventory/catalog/material-types/9999', { name: 'Fantasma' });
    expect(type.status).toBe(404);
  });
});

describe('actas imprimibles', () => {
  it('el acta de entrega incluye la entrega completa, aunque ya se haya devuelto algo', async () => {
    const { api, materialId, personId, bodegaId } = await bootstrap(3);

    // El membrete debe llevar los datos de la institución configurada.
    await api.put('/api/v1/site/institution', {
      name: 'Bomba Carlos Collins',
      number: 'Segunda Compañía',
    });

    const assigned = await api.post<{ batchId: string }>(
      `/api/v1/persons/${personId}/assignments`,
      {
        deliveredBy: 'Capitán Pérez',
        notes: 'Entrega de prueba',
        lines: [{ materialId, locationId: bodegaId, quantity: 2, conditionOut: 'operativo' }],
      },
    );
    expect(assigned.status).toBe(201);
    const batchId = assigned.body.data?.batchId ?? '';
    expect(batchId.length).toBeGreaterThan(0);

    // Devolución parcial: el acta debe seguir documentando la entrega completa.
    const detail = await api.get<{
      assignments: { id: number; quantity: number; returned_qty: number }[];
    }>(`/api/v1/persons/${personId}`);
    const lineId = detail.body.data?.assignments[0]?.id ?? 0;
    expect(lineId).toBeGreaterThan(0);

    const returned = await api.post(`/api/v1/persons/${personId}/returns`, {
      receivedBy: 'Teniente Soto',
      toLocationId: bodegaId,
      conditionCode: 'operativo',
      lines: [{ assignmentLineId: lineId, quantity: 1 }],
    });
    expect(returned.status).toBe(201);

    const acta = await api.get<{
      institution: { name: string };
      acta: {
        kind: string;
        deliveredBy: string | null;
        notes: string | null;
        person: { fullName: string };
        lines: { quantity: number; returnedQty: number; conditionOutName: string | null }[];
      };
    }>(`/api/v1/persons/${personId}/batches/${encodeURIComponent(batchId)}/acta`);

    expect(acta.status).toBe(200);
    expect(acta.body.data?.acta.kind).toBe('entrega');
    expect(acta.body.data?.acta.deliveredBy).toBe('Capitán Pérez');
    expect(acta.body.data?.acta.notes).toBe('Entrega de prueba');
    expect(acta.body.data?.acta.person.fullName).toBe('Integrante de Prueba');
    expect(acta.body.data?.institution.name).toBe('Bomba Carlos Collins');
    expect(acta.body.data?.institution.number).toBe('Segunda Compañía');

    const line = acta.body.data?.acta.lines[0];
    expect(line?.quantity).toBe(2);
    expect(line?.returnedQty).toBe(1);
    expect(line?.conditionOutName).toBeTruthy();
  });

  it('el acta de baja incluye motivo, quién autoriza y la condición anterior', async () => {
    const { api, materialId, bodegaId } = await bootstrap(2);

    await api.put('/api/v1/site/institution', { name: 'Bomba Carlos Collins' });

    const baja = await api.post<{ writeoffId: number }>('/api/v1/inventory/writeoffs', {
      materialId,
      locationId: bodegaId,
      conditionCode: 'operativo',
      quantity: 1,
      reason: 'Daño irreparable en el casco',
      authorizedBy: 'Comandante Rivas',
    });
    expect(baja.status).toBe(201);
    const writeoffId = baja.body.data?.writeoffId ?? 0;
    expect(writeoffId).toBeGreaterThan(0);

    const acta = await api.get<{
      institution: { name: string };
      acta: {
        kind: string;
        reason: string;
        authorizedBy: string;
        locationName: string | null;
        lines: { itemName: string | null; quantity: number; priorConditionName: string | null }[];
      };
    }>(`/api/v1/inventory/writeoffs/${writeoffId}/acta`);

    expect(acta.status).toBe(200);
    expect(acta.body.data?.acta.kind).toBe('baja');
    expect(acta.body.data?.acta.reason).toBe('Daño irreparable en el casco');
    expect(acta.body.data?.acta.authorizedBy).toBe('Comandante Rivas');
    expect(acta.body.data?.acta.locationName).toBe('Bodega');
    expect(acta.body.data?.institution.name).toBe('Bomba Carlos Collins');
    expect(acta.body.data?.acta.lines[0]?.quantity).toBe(1);
    expect(acta.body.data?.acta.lines[0]?.priorConditionName).toBeTruthy();
  });

  it('responde 404 cuando el acta no existe', async () => {
    const { api, personId } = await bootstrap(1);

    const sinEntrega = await api.get(`/api/v1/persons/${personId}/batches/no-existe/acta`);
    expect(sinEntrega.status).toBe(404);

    const sinBaja = await api.get('/api/v1/inventory/writeoffs/99999/acta');
    expect(sinBaja.status).toBe(404);
  });
});

describe('informes', () => {
  it('el inventario imprimible resume totales y desglose por ubicación', async () => {
    const { api, materialId, bodegaId, salaId } = await bootstrap(3);
    await api.put('/api/v1/site/institution', { name: 'Bomba Carlos Collins' });

    // Un traslado para que el desglose tenga dos ubicaciones.
    const transfer = await api.post('/api/v1/inventory/transfers', {
      materialId,
      fromLocationId: bodegaId,
      toLocationId: salaId,
      conditionCode: 'operativo',
      quantity: 1,
    });
    expect(transfer.status).toBe(201);

    const report = await api.get<{
      institution: { name: string };
      generatedAt: string;
      totals: {
        code: string;
        name: string;
        total: number;
        available: number;
        unavailable: number;
        minStock: number;
        belowMinStock: boolean;
        photoObjectId: number | null;
      }[];
      detail: { name: string; location: string; quantity: number }[];
    }>('/api/v1/reports/inventory');

    expect(report.status).toBe(200);
    expect(report.body.data?.institution.name).toBe('Bomba Carlos Collins');
    expect(report.body.data?.generatedAt).toBeTruthy();

    const totals = report.body.data?.totals[0];
    expect(totals?.total).toBe(3);
    expect(totals?.available).toBe(3);
    expect(totals?.unavailable).toBe(0);
    expect(totals?.minStock).toBe(1);
    expect(totals?.belowMinStock).toBe(false);

    const locations = (report.body.data?.detail ?? []).map((row) => row.location).sort();
    expect(locations).toEqual(['Bodega', 'Sala']);
  });

  it('el panel de resumen devuelve los contadores', async () => {
    const { api } = await bootstrap(4);

    const summary = await api.get<{ materials: number; units: number }>('/api/v1/reports/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data?.materials).toBe(1);
    expect(summary.body.data?.units).toBe(4);
  });

  it('marca bajo mínimo cuando las existencias no alcanzan el mínimo', async () => {
    const { api, materialId } = await bootstrap(2);
    await api.put(`/api/v1/inventory/materials/${materialId}`, { minStock: 5 });

    const report = await api.get<{ totals: { total: number; minStock: number; belowMinStock: boolean }[] }>(
      '/api/v1/reports/inventory',
    );
    expect(report.body.data?.totals[0]?.total).toBe(2);
    expect(report.body.data?.totals[0]?.minStock).toBe(5);
    expect(report.body.data?.totals[0]?.belowMinStock).toBe(true);
  });
});

describe('catálogo de personas y ficha', () => {
  // `position_types` y `qualities` son datos de referencia que las pruebas
  // conservan entre casos (no están en el vaciado de `tests/setup.ts`) y las
  // calidades vienen sembradas. Por eso cada caso usa nombres propios: si no,
  // el `UNIQUE` del nombre devuelve 409 y la prueba pasaría por el motivo
  // equivocado.
  it('gestiona cargos y calidades: crear, editar, duplicar y archivar', async () => {
    const { api } = await bootstrap(1);

    const cargo = await api.post<{ id: number }>('/api/v1/persons/catalog/position-types', {
      name: 'Cargo de prueba',
    });
    expect(cargo.status).toBe(201);
    const cargoId = cargo.body.data?.id ?? 0;
    expect(cargoId).toBeGreaterThan(0);

    const edited = await api.put(`/api/v1/persons/catalog/position-types/${cargoId}`, {
      name: 'Cargo de prueba (editado)',
    });
    expect(edited.status).toBe(200);

    const catalog = await api.get<{ positionTypes: { id: number; name: string }[] }>(
      '/api/v1/persons/catalog',
    );
    expect(catalog.body.data?.positionTypes.find((p) => p.id === cargoId)?.name).toBe(
      'Cargo de prueba (editado)',
    );

    const conflict = await api.post('/api/v1/persons/catalog/position-types', {
      name: 'Cargo de prueba (editado)',
    });
    expect(conflict.status).toBe(409);

    const archived = await api.del(`/api/v1/persons/catalog/position-types/${cargoId}`);
    expect(archived.status).toBe(200);
    const after = await api.get<{ positionTypes: { id: number }[] }>('/api/v1/persons/catalog');
    expect(after.body.data?.positionTypes.some((p) => p.id === cargoId)).toBe(false);

    const calidad = await api.post<{ id: number }>('/api/v1/persons/catalog/qualities', {
      name: 'Calidad de prueba',
    });
    expect(calidad.status).toBe(201);
    const calidadId = calidad.body.data?.id ?? 0;
    expect(calidadId).toBeGreaterThan(0);

    const calidadEdit = await api.put(`/api/v1/persons/catalog/qualities/${calidadId}`, {
      name: 'Calidad de prueba (editada)',
    });
    expect(calidadEdit.status).toBe(200);
    expect((await api.del(`/api/v1/persons/catalog/qualities/${calidadId}`)).status).toBe(200);
  });

  it('responde 404 al editar o archivar una entrada que no existe', async () => {
    const { api } = await bootstrap(1);

    const edited = await api.put('/api/v1/persons/catalog/position-types/9999', { name: 'Fantasma' });
    expect(edited.status).toBe(404);

    const archived = await api.del('/api/v1/persons/catalog/qualities/9999');
    expect(archived.status).toBe(404);
  });

  it('la ficha trae datos, cargos, notas saneadas y material pendiente', async () => {
    const { api, materialId, personId, bodegaId } = await bootstrap(2);
    await api.put('/api/v1/site/institution', { name: 'Bomba Carlos Collins' });

    const calidad = await api.post<{ id: number }>('/api/v1/persons/catalog/qualities', {
      name: 'Calidad de ficha',
    });
    expect(calidad.status).toBe(201);
    const calidadId = calidad.body.data?.id ?? 0;
    const cargo = await api.post<{ id: number }>('/api/v1/persons/catalog/position-types', {
      name: 'Cargo de ficha',
    });
    expect(cargo.status).toBe(201);
    const cargoId = cargo.body.data?.id ?? 0;

    const updated = await api.put(`/api/v1/persons/${personId}`, {
      fullName: 'Integrante de Prueba',
      qualityId: calidadId,
      history: '<p>Notas con <strong>negrita</strong></p><script>alert(1)</script>',
    });
    expect(updated.status).toBe(200);

    const position = await api.post(`/api/v1/persons/${personId}/positions`, {
      positionTypeId: cargoId,
      startDate: '2024-03-01',
    });
    expect(position.status).toBe(201);
    await api.post(`/api/v1/persons/${personId}/assignments`, {
      deliveredBy: 'Capitán Pérez',
      lines: [{ materialId, locationId: bodegaId, quantity: 2, conditionOut: 'operativo' }],
    });

    const ficha = await api.get<{
      institution: { name: string };
      person: { fullName: string; qualityName: string | null; history: string | null };
      positions: { name: string; startDate: string | null }[];
      assignments: { itemName: string; quantity: number; conditionName: string | null }[];
      generatedAt: string;
    }>(`/api/v1/persons/${personId}/ficha`);

    expect(ficha.status).toBe(200);
    expect(ficha.body.data?.institution.name).toBe('Bomba Carlos Collins');
    expect(ficha.body.data?.person.fullName).toBe('Integrante de Prueba');
    expect(ficha.body.data?.person.qualityName).toBe('Calidad de ficha');
    // Las notas se sanean al guardar: fuera el script, dentro el formato.
    expect(ficha.body.data?.person.history).toBe('<p>Notas con <strong>negrita</strong></p>');
    expect(ficha.body.data?.positions[0]?.name).toBe('Cargo de ficha');
    expect(ficha.body.data?.positions[0]?.startDate).toBe('2024-03-01');
    expect(ficha.body.data?.assignments[0]?.quantity).toBe(2);
    expect(ficha.body.data?.assignments[0]?.conditionName).toBeTruthy();
    expect(ficha.body.data?.generatedAt).toBeTruthy();
  });

  it('responde 404 si la ficha no existe', async () => {
    const { api } = await bootstrap(1);
    const missing = await api.get('/api/v1/persons/99999/ficha');
    expect(missing.status).toBe(404);
  });

  it('guarda la foto de la persona y la lleva a la ficha', async () => {
    const { api, personId } = await bootstrap(1);

    // La foto es un dato personal: se sube como objeto privado.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const binary = atob(png);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'persona.png', { type: 'image/png' }));
    form.append('isPublic', 'false');
    form.append('scope', 'person');
    const uploaded = await api.request<{ id: number }>('POST', '/api/v1/files', {
      form,
      csrf: true,
    });
    expect(uploaded.status).toBe(201);
    const objectId = uploaded.body.data?.id ?? 0;

    const updated = await api.put(`/api/v1/persons/${personId}`, {
      fullName: 'Integrante de Prueba',
      photoObjectId: objectId,
    });
    expect(updated.status).toBe(200);

    const detail = await api.get<{ person: { photo_object_id: number | null } }>(
      `/api/v1/persons/${personId}`,
    );
    expect(detail.body.data?.person.photo_object_id).toBe(objectId);

    const ficha = await api.get<{ person: { photoObjectId: number | null } }>(
      `/api/v1/persons/${personId}/ficha`,
    );
    expect(ficha.body.data?.person.photoObjectId).toBe(objectId);

    // Quitar la foto es enviar `null`.
    await api.put(`/api/v1/persons/${personId}`, {
      fullName: 'Integrante de Prueba',
      photoObjectId: null,
    });
    const cleared = await api.get<{ person: { photo_object_id: number | null } }>(
      `/api/v1/persons/${personId}`,
    );
    expect(cleared.body.data?.person.photo_object_id).toBeNull();
  });
});
