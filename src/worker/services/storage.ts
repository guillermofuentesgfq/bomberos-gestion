import type { Env } from '../lib/env';
import { first, run } from '../lib/db';
import { nowIso } from '../lib/time';
import { randomId } from '../lib/ids';
import { AppError } from '../lib/errors';
import {
  extensionForImageType,
  mimeForImageType,
  validateImageFile,
} from '../lib/image';
import { logAudit } from '../security/audit';
import type { PermissionCode } from '../security/permissions';

/** Ámbito al que pertenece un objeto: decide qué permiso exige cada operación. */
export type StorageScope = 'site' | 'inventory' | 'person';

/** Fila completa de `storage_objects`. */
export interface StorageObjectRow {
  id: number;
  object_key: string;
  original_name: string | null;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  is_public: number;
  scope: StorageScope;
  alt_text: string | null;
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
  archived_at: string | null;
}

const STORAGE_COLUMNS = `id, object_key, original_name, content_type, byte_size,
  width, height, checksum, is_public, scope, alt_text, caption, uploaded_by, created_at, archived_at`;

export interface StoreObjectInput {
  bytes: Uint8Array<ArrayBuffer>;
  originalName: string | null;
  declaredType: string | null;
  altText: string | null;
  caption: string | null;
  isPublic: boolean;
  scope: StorageScope;
  uploadedBy: number | null;
  ipHash: string | null;
}

export interface StoredObject {
  id: number;
  objectKey: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  isPublic: boolean;
  scope: StorageScope;
}

/**
 * Permiso de lectura y de escritura que exige cada ámbito del almacén.
 *
 * Es la política que impide el salto entre dominios: leer o archivar la foto de
 * una persona exige `persons.read`/`persons.write`, no el permiso de cualquier
 * otro apartado que comparta el mismo almacén.
 */
export const SCOPE_PERMISSIONS: Record<
  StorageScope,
  { read: PermissionCode; write: PermissionCode }
> = {
  site: { read: 'site.read', write: 'site.write' },
  inventory: { read: 'inventory.read', write: 'inventory.write' },
  person: { read: 'persons.read', write: 'persons.write' },
};

/** SHA-256 hexadecimal sobre los bytes crudos (no sobre una codificación). */
async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Valida la imagen, la sube a R2 y registra la fila en `storage_objects`.
 *
 * La clave del objeto es aleatoria (`objects/<hex>.<ext>`) para no filtrar el
 * nombre original ni permitir colisiones. Lanza `AppError` uniforme si la
 * imagen no es válida.
 */
export async function storeObject(env: Env, input: StoreObjectInput): Promise<StoredObject> {
  // `is_public` solo está previsto para imágenes institucionales del sitio: un
  // objeto de inventario o de una persona es siempre privado, y publicarlo exige
  // autoridad del dominio sitio (se comprueba además en la ruta).
  if (input.isPublic && input.scope !== 'site') {
    throw AppError.unprocessable('Solo las imágenes del sitio pueden publicarse.');
  }

  const validation = validateImageFile(input.bytes, input.declaredType ?? undefined);
  if (!validation.ok) {
    throw AppError.unprocessable(validation.reason);
  }

  const contentType = mimeForImageType(validation.type);
  const objectKey = `objects/${randomId(16)}.${extensionForImageType(validation.type)}`;
  const byteSize = input.bytes.byteLength;
  const checksum = await sha256BytesHex(input.bytes);

  await env.FILES.put(objectKey, input.bytes, { httpMetadata: { contentType } });

  const inserted = await run(
    env.DB,
    `INSERT INTO storage_objects
       (object_key, original_name, content_type, byte_size, width, height, checksum,
        is_public, scope, alt_text, caption, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    objectKey,
    input.originalName,
    contentType,
    byteSize,
    validation.width,
    validation.height,
    checksum,
    input.isPublic ? 1 : 0,
    input.scope,
    input.altText,
    input.caption,
    input.uploadedBy,
    nowIso(),
  );
  const id = Number(inserted.meta.last_row_id);

  await logAudit(env.DB, {
    actorUserId: input.uploadedBy,
    action: 'storage.upload',
    entityType: 'storage_object',
    entityId: id,
    detail: {
      originalName: input.originalName,
      contentType,
      byteSize,
      width: validation.width,
      height: validation.height,
      isPublic: input.isPublic,
    },
    ipHash: input.ipHash,
  });

  return {
    id,
    objectKey,
    contentType,
    byteSize,
    width: validation.width,
    height: validation.height,
    isPublic: input.isPublic,
    scope: input.scope,
  };
}

/**
 * Comprueba que el objeto referido existe, no está archivado y pertenece al
 * ámbito esperado. Es lo que impide que una ficha de persona enlace la foto
 * privada de otro dominio (o al revés): la referencia se valida al escribir,
 * no solo al leer.
 */
export async function requireScopedObject(
  db: D1Database,
  id: number,
  scope: StorageScope,
): Promise<StorageObjectRow> {
  const record = await getObjectRecord(db, id);
  if (!record || record.scope !== scope) {
    throw AppError.unprocessable(
      'El archivo indicado no existe o no corresponde a este apartado.',
    );
  }
  return record;
}

/** Devuelve la fila de `storage_objects` o `null` si no existe o está archivada. */
export async function getObjectRecord(
  db: D1Database,
  id: number,
): Promise<StorageObjectRow | null> {
  return first<StorageObjectRow>(
    db,
    `SELECT ${STORAGE_COLUMNS} FROM storage_objects WHERE id = ? AND archived_at IS NULL`,
    id,
  );
}

/** Cuerpo del objeto en R2, o `null` si la clave no existe. */
export async function objectBody(env: Env, objectKey: string): Promise<R2ObjectBody | null> {
  return env.FILES.get(objectKey);
}

/** Actor que realiza la operación de archivado (para la auditoría). */
export interface StorageActor {
  id: number | null;
  username: string | null;
  ipHash: string | null;
}

/**
 * Archiva el objeto: marca `archived_at` y audita. No borra el objeto de R2,
 * que se limpia de forma controlada en un proceso posterior.
 */
export async function archiveObject(
  _env: Env,
  db: D1Database,
  id: number,
  actor: StorageActor,
): Promise<boolean> {
  const result = await run(
    db,
    `UPDATE storage_objects SET archived_at = ? WHERE id = ? AND archived_at IS NULL`,
    nowIso(),
    id,
  );
  const changed = result.meta.changes ?? 0;
  if (changed === 0) return false;

  await logAudit(db, {
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: 'storage.archive',
    entityType: 'storage_object',
    entityId: id,
    ipHash: actor.ipHash,
  });
  return true;
}

/**
 * Elimina definitivamente el objeto de R2 y su fila. Uso administrativo
 * explícito; las eliminaciones normales usan `archiveObject`.
 */
export async function deleteObject(env: Env, db: D1Database, id: number): Promise<boolean> {
  const record = await first<{ object_key: string }>(
    db,
    `SELECT object_key FROM storage_objects WHERE id = ?`,
    id,
  );
  if (!record) return false;

  await env.FILES.delete(record.object_key);
  await run(db, `DELETE FROM storage_objects WHERE id = ?`, id);
  return true;
}
