import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { ApiClient, countRows, seedUser } from './helpers';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  const binary = atob(PNG_1X1_BASE64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pngForm(): FormData {
  const form = new FormData();
  form.append('file', new File([pngBytes()], 'foto.png', { type: 'image/png' }));
  return form;
}

/** Formulario de subida con un ámbito concreto (por defecto, el del sitio). */
function scopedForm(scope: 'site' | 'inventory' | 'person'): FormData {
  const form = pngForm();
  form.append('scope', scope);
  return form;
}

async function uploadScoped(api: ApiClient, scope: 'site' | 'inventory' | 'person'): Promise<number> {
  const response = await api.request<{ id: number }>('POST', '/api/v1/files', {
    form: scopedForm(scope),
    csrf: true,
  });
  expect(response.status).toBe(201);
  return response.body.data?.id ?? 0;
}

async function adminClient(): Promise<ApiClient> {
  const api = new ApiClient();
  await api.setupAdmin();
  return api;
}

describe('almacenamiento de archivos', () => {
  it('sube una imagen válida y la sirve solo con sesión (privada por defecto)', async () => {
    const api = await adminClient();
    const upload = await api.request<{ id: number; isPublic: boolean; contentType: string }>(
      'POST',
      '/api/v1/files',
      { form: pngForm(), csrf: true },
    );
    expect(upload.status).toBe(201);
    expect(upload.body.data?.isPublic).toBe(false);
    expect(upload.body.data?.contentType).toBe('image/png');

    const id = upload.body.data?.id ?? 0;

    // Sin sesión: no se revela la existencia de un archivo privado.
    const anonymous = new ApiClient();
    expect((await anonymous.get(`/api/v1/files/${id}`)).status).toBe(404);

    // Con sesión y permiso: se sirve.
    const served = await api.get(`/api/v1/files/${id}`);
    expect(served.status).toBe(200);
  });

  it('rechaza contenido activo (SVG) aunque la extensión parezca de imagen', async () => {
    const api = await adminClient();
    const form = new FormData();
    form.append(
      'file',
      new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'logo.svg', {
        type: 'image/svg+xml',
      }),
    );
    const response = await api.request('POST', '/api/v1/files', { form, csrf: true });
    expect(response.status).toBe(422);
    expect(await countRows('storage_objects')).toBe(0);
  });

  it('rechaza un archivo que no es una imagen', async () => {
    const api = await adminClient();
    const form = new FormData();
    form.append('file', new File(['#!/bin/sh\necho hola'], 'script.png', { type: 'image/png' }));
    const response = await api.request('POST', '/api/v1/files', { form, csrf: true });
    expect(response.status).toBe(422);
    expect(await countRows('storage_objects')).toBe(0);
  });

  it('exige sesión para subir archivos', async () => {    const api = await adminClient();
    const anonymous = new ApiClient();
    const response = await anonymous.request('POST', '/api/v1/files', { form: pngForm(), csrf: true });
    expect(response.status).toBe(401);
  });

  it('aplica un tope agregado al almacén', async () => {
    const api = await adminClient();
    // Se simula un almacén lleno con una fila de un byte de un gibibyte.
    await env.DB.prepare(
      `INSERT INTO storage_objects (object_key, content_type, byte_size, is_public, scope, created_at)
       VALUES ('objects/lleno.png', 'image/png', ?, 0, 'site', ?)`,
    )
      .bind(1024 * 1024 * 1024, new Date().toISOString())
      .run();

    const response = await api.request('POST', '/api/v1/files', { form: pngForm(), csrf: true });
    expect(response.status).toBe(413);
    // Y no quedaron bytes huérfanos en R2: se comprueba antes de escribir.
    expect(await countRows('storage_objects')).toBe(1);
  });

  it('exige el permiso del ámbito del objeto para verlo y retirarlo', async () => {
    const api = await adminClient();
    const materialPhoto = await uploadScoped(api, 'inventory');
    const personPhoto = await uploadScoped(api, 'person');

    // Editor del sitio (site.read + site.write, sin inventario ni personas).
    await seedUser('editor-sitio', 'ContrasenaLarga123', 'site_editor');
    const editor = new ApiClient();
    expect(await editor.login('editor-sitio', 'ContrasenaLarga123')).toBe(200);

    // No ve las fotos de otros apartados (404 enmascarado)…
    expect((await editor.get(`/api/v1/files/${materialPhoto}`)).status).toBe(404);
    expect((await editor.get(`/api/v1/files/${personPhoto}`)).status).toBe(404);
    // …ni puede retirarlas.
    expect((await editor.del(`/api/v1/files/${materialPhoto}`)).status).toBe(403);
    expect((await editor.del(`/api/v1/files/${personPhoto}`)).status).toBe(403);

    // Quien tiene el permiso del ámbito sí ve la foto de ese ámbito: el control
    // es el permiso por ámbito, no un permiso general de la subida.
    await seedUser('encargado', 'ContrasenaLarga123', 'inventory_manager');
    const manager = new ApiClient();
    expect(await manager.login('encargado', 'ContrasenaLarga123')).toBe(200);
    expect((await manager.get(`/api/v1/files/${materialPhoto}`)).status).toBe(200);
  });

  it('solo quien administra el sitio puede publicar una imagen', async () => {
    await adminClient();
    await seedUser('encargado', 'ContrasenaLarga123', 'inventory_manager');
    const manager = new ApiClient();
    expect(await manager.login('encargado', 'ContrasenaLarga123')).toBe(200);

    // Publicar exige autoridad del sitio, aunque el ámbito sea el de inventario.
    const publicInventory = scopedForm('inventory');
    publicInventory.append('isPublic', 'true');
    expect(
      (await manager.request('POST', '/api/v1/files', { form: publicInventory, csrf: true })).status,
    ).toBe(403);

    // Y subir a un ámbito ajeno, también.
    expect(
      (await manager.request('POST', '/api/v1/files', { form: scopedForm('site'), csrf: true })).status,
    ).toBe(403);

    // Una imagen privada de su propio ámbito sí se admite.
    expect(
      (await manager.request('POST', '/api/v1/files', { form: scopedForm('inventory'), csrf: true })).status,
    ).toBe(201);
  });

  it('no permite enlazar en una persona o un material una foto de otro apartado', async () => {
    const api = await adminClient();
    const sitePhoto = await uploadScoped(api, 'site');

    const person = await api.post('/api/v1/persons', {
      fullName: 'Persona de Prueba',
      photoObjectId: sitePhoto,
    });
    expect(person.status).toBe(422);

    const material = await api.post('/api/v1/inventory/materials', {
      name: 'Material de Prueba',
      photoObjectId: sitePhoto,
    });
    expect(material.status).toBe(422);
  });
});
