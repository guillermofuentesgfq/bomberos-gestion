-- ---------------------------------------------------------------------------
-- 0006 — Importación masiva desde hojas de cálculo (XLSX / XLS / CSV)
--
-- El archivo se parsea en el navegador y la API recibe las filas ya
-- normalizadas en lotes. Cada lote vive en un `import_batches` con sus filas en
-- una tabla de staging por tipo. La confirmación se hace con SQL set-based
-- (INSERT … SELECT) leyendo el staging: pocas sentencias para miles de filas.
--
-- El staging es transitorio: la limpieza periódica lo purga.
-- ---------------------------------------------------------------------------

CREATE TABLE import_batches (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('material', 'person')),
  filename     TEXT,
  status       TEXT NOT NULL DEFAULT 'analyzing'
                 CHECK (status IN ('analyzing', 'ready', 'committing', 'committed', 'failed')),
  total_rows   INTEGER NOT NULL DEFAULT 0,
  valid_rows   INTEGER NOT NULL DEFAULT 0,
  error_rows   INTEGER NOT NULL DEFAULT 0,
  warning_rows INTEGER NOT NULL DEFAULT 0,
  mode         TEXT CHECK (mode IS NULL OR mode IN ('all_or_nothing', 'valid_only')),
  result       TEXT,                 -- JSON con el resumen final
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX idx_import_batches_created ON import_batches(created_at);
CREATE INDEX idx_import_batches_status  ON import_batches(status, created_at);

-- Una fila analizada de material. `status`:
--   valid    → pasó la validación, pendiente de confirmar
--   error    → no se puede importar; `issues` explica por qué
--   committed→ ya escrita en `materials`/`stock_levels`
--   skipped  → válida, pero omitida por el modo «solo válidas» de otro error
CREATE TABLE import_rows_material (
  id               INTEGER PRIMARY KEY,
  batch_id         INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no           INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('valid', 'error', 'committed', 'skipped')),
  issues           TEXT,             -- JSON [{column, code, message, severity}]
  code             TEXT,
  name             TEXT,
  category_id      INTEGER,
  material_type_id INTEGER,
  brand            TEXT,
  model            TEXT,
  notes            TEXT,
  min_stock        INTEGER,
  is_individual    INTEGER,
  location_id      INTEGER,
  condition_code   TEXT,
  quantity         INTEGER,
  UNIQUE (batch_id, row_no)
);
CREATE INDEX idx_import_rows_material_batch ON import_rows_material(batch_id, status);
CREATE INDEX idx_import_rows_material_code  ON import_rows_material(batch_id, code);

-- Una fila analizada de persona.
CREATE TABLE import_rows_person (
  id              INTEGER PRIMARY KEY,
  batch_id        INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no          INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('valid', 'error', 'committed', 'skipped')),
  issues          TEXT,
  full_name       TEXT,
  rut             TEXT,
  person_id       INTEGER,           -- relleno al confirmar, para cargos
  quality_id      INTEGER,
  position_type_id INTEGER,
  position_label  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  birth_date      TEXT,
  join_date       TEXT,
  registry_no     TEXT,
  emergency_name  TEXT,
  emergency_phone TEXT,
  history         TEXT,
  is_active       INTEGER,
  UNIQUE (batch_id, row_no)
);
CREATE INDEX idx_import_rows_person_batch ON import_rows_person(batch_id, status);
CREATE INDEX idx_import_rows_person_rut   ON import_rows_person(batch_id, rut);

-- Permiso de importación de fichas de personal. La importación de materiales
-- reutiliza `inventory.import`, que ya existía.
INSERT OR IGNORE INTO permissions (code, description) VALUES
  ('persons.import', 'Importar fichas de personal desde una planilla');

-- Administrador (1): todos los permisos, incluido el nuevo.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
  SELECT 1, code FROM permissions;

-- Responsable de asignaciones (3): ya gestiona fichas, así que también importa.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  (3, 'persons.import');
