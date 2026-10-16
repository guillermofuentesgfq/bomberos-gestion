import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { MAX_IMAGE_BYTES } from '../lib/image';
import { parseWith } from '../lib/validate';
import { requireAuth, requireCsrf } from '../security/middleware';
import { hasPermission } from '../security/permissions';
import {
  archiveObject,
  getObjectRecord,
  objectBody,
  SCOPE_PERMISSIONS,
  storeObject,
  type StorageScope,
} from '../services/storage';

type AppEnv = { Bindings: Env; Variables: Variables };

/** Margen sobre el límite de la imagen para las cabeceras multipart. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export const filesRoutes = new Hono<AppEnv>();

const scopeSchema = z.enum(['site', 'inventory', 'person']);

function optionalText(value: FormDataEntryValue | null, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function parseObjectId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw AppError.notFound();
  return id;
}

/** Nombre de archivo seguro para `content-disposition: inline`. */
function inlineDisposition(name: string | null): string {
  if (!name) return 'inline';
  const safe = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 200);
  return safe.length > 0 ? `inline; filename="${safe}"` : 'inline';
}

/**
 * Sube una imagen. Cuerpo `multipart/form-data` con el campo obligatorio
 * `file` y los campos opcionales `alt`, `caption`, `isPublic`, `scope` y
 * `originalName`.
 *
 * El `scope` decide qué permiso de escritura se exige y a qué dominio pertenece
 * el objeto: `site` (sitio público), `inventory` (materiales) o `person`
 * (personal). Solo los objetos del sitio pueden marcarse como públicos.
 */
filesRoutes.post('/', requireAuth, requireCsrf, async (c) => {
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw AppError.payloadTooLarge('La carga supera el tamaño máximo permitido.');
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw AppError.badRequest('Se esperaba una carga multipart/form-data con el campo "file".');
  }

  const entry = form.get('file');
  if (!(entry instanceof File)) {
    throw AppError.unprocessable('Falta el campo "file" con la imagen.');
  }
  if (entry.size > MAX_IMAGE_BYTES) {
    throw AppError.payloadTooLarge('La imagen supera el tamaño máximo permitido.');
  }

  const user = c.get('user');
  if (!user) throw AppError.unauthorized();

  const scope: StorageScope = parseWith(scopeSchema, optionalText(form.get('scope'), 20) ?? 'site');
  const isPublic = parseBoolean(form.get('isPublic'));

  // Cada ámbito exige su propio permiso de escritura; publicar exige además el
  // del sitio, porque `is_public` es la puerta al nivel anónimo.
  if (!hasPermission(user.permissions, SCOPE_PERMISSIONS[scope].write)) {
    throw AppError.forbidden('No tienes permiso para subir archivos de este apartado.');
  }
  if (isPublic && !hasPermission(user.permissions, SCOPE_PERMISSIONS.site.write)) {
    throw AppError.forbidden('Solo quien administra el sitio puede publicar imágenes.');
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const originalName =
    optionalText(form.get('originalName'), 255) ??
    optionalText(entry.name, 255);

  const stored = await storeObject(c.env, {
    bytes,
    originalName,
    declaredType: entry.type.length > 0 ? entry.type : null,
    altText: optionalText(form.get('alt'), 300),
    caption: optionalText(form.get('caption'), 1000),
    isPublic,
    scope,
    uploadedBy: user.id,
    ipHash: c.get('ipHash'),
  });

  return ok(c, stored, 201);
});

/**
 * Descarga una imagen. Las públicas se sirven sin sesión; las privadas exigen
 * sesión y el permiso de lectura del ámbito al que pertenecen (una foto de una
 * persona exige `persons.read`, la de un material `inventory.read`, y un objeto
 * del sitio `site.read`). A quien no puede verlas se le responde 404 para no
 * revelar su existencia.
 */
filesRoutes.get('/:id', async (c) => {
  const id = parseObjectId(c.req.param('id'));
  const record = await getObjectRecord(c.env.DB, id);
  if (!record) throw AppError.notFound();

  if (record.is_public !== 1) {
    const user = c.get('user');
    if (!user || !hasPermission(user.permissions, SCOPE_PERMISSIONS[record.scope].read)) {
      throw AppError.notFound();
    }
  }

  const object = await objectBody(c.env, record.object_key);
  if (!object) throw AppError.notFound();

  c.header('content-type', record.content_type);
  c.header('content-length', String(object.size));
  c.header(
    'cache-control',
    record.is_public === 1 ? 'public, max-age=31536000, immutable' : 'private, no-store',
  );
  c.header('content-disposition', inlineDisposition(record.original_name));
  c.header('x-content-type-options', 'nosniff');
  if (object.httpEtag) c.header('etag', object.httpEtag);

  return c.body(object.body, 200);
});

/**
 * Archiva un objeto (no borra el objeto de R2; la limpieza es posterior).
 *
 * El permiso que se exige es el del ámbito del objeto: archivar la foto de una
 * persona pide `persons.write`, no el permiso de cualquier otro apartado que
 * comparta el almacén.
 */
filesRoutes.delete('/:id', requireAuth, requireCsrf, async (c) => {
  const id = parseObjectId(c.req.param('id'));
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();

  const record = await getObjectRecord(c.env.DB, id);
  if (!record) throw AppError.notFound();

  if (!hasPermission(user.permissions, SCOPE_PERMISSIONS[record.scope].write)) {
    throw AppError.forbidden('No tienes permiso para retirar archivos de este apartado.');
  }

  await archiveObject(c.env, c.env.DB, id, {
    id: user.id,
    username: user.username,
    ipHash: c.get('ipHash'),
  });

  return ok(c, { id, archived: true });
});
