import { describe, expect, it } from 'vitest';
import { ApiClient, countRows } from './helpers';

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

  it('exige sesión para subir archivos', async () => {
    const api = await adminClient();
    const anonymous = new ApiClient();
    const response = await anonymous.request('POST', '/api/v1/files', { form: pngForm(), csrf: true });
    expect(response.status).toBe(401);
  });
});
