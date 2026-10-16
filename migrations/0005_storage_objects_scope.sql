-- === Permisos por objeto en el almacén de archivos =========================
--
-- Hasta ahora la descarga, el archivado y la publicación de un objeto se
-- autorizaban con un permiso «general» de la subida (cualquiera de los dos
-- dominios de escritura), sin saber a qué dominio pertenecía el objeto. Eso
-- permitía, por ejemplo, que un editor del sitio pudiera descargar o retirar la
-- foto privada de una persona con `site.read`/`site.write`.
--
-- `scope` marca el dominio del objeto y con él se decide qué permiso exige cada
-- operación: leer/archivar una foto de una persona exige `persons.read`/`write`,
-- la de un material `inventory.read`/`write`, y un objeto del sitio
-- `site.read`/`write`. Solo los objetos de ámbito `site` pueden publicarse
-- (`is_public = 1`), que es lo que el esquema ya declaraba como política.
--
-- Se rellenan las filas existentes a partir de las referencias que ya existen:
-- una foto referenciada por una persona es de ámbito `person`; una referenciada
-- por un material, `inventory`; el resto quedan en `site` (el valor por defecto).

ALTER TABLE storage_objects ADD COLUMN scope TEXT NOT NULL DEFAULT 'site'
  CHECK (scope IN ('site', 'inventory', 'person'));

UPDATE storage_objects
   SET scope = 'person'
 WHERE id IN (SELECT photo_object_id FROM persons WHERE photo_object_id IS NOT NULL);

UPDATE storage_objects
   SET scope = 'inventory'
 WHERE id IN (SELECT photo_object_id FROM materials WHERE photo_object_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_storage_objects_scope ON storage_objects (scope);
