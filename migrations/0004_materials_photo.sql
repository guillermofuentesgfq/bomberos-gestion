-- Foto del material.
--
-- Es un objeto de `storage_objects` con `is_public = 0`: las imágenes del
-- inventario no se exponen en el sitio público, se sirven solo con sesión.
-- Al archivar el objeto la referencia queda en NULL en vez de romper la fila.

ALTER TABLE materials ADD COLUMN photo_object_id INTEGER
  REFERENCES storage_objects(id) ON DELETE SET NULL;

CREATE INDEX idx_materials_photo ON materials(photo_object_id);
