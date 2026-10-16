-- ---------------------------------------------------------------------------
-- 0001 — Esquema inicial (D1 / SQLite)
--
-- Instalación por institución: esta base de datos pertenece a UNA sola
-- institución. No hay multitenencia ni columna de tenant.
--
-- Convenciones:
--   * Fechas en ISO-8601 UTC (TEXT).
--   * Booleanos como INTEGER 0/1 con CHECK.
--   * Contraindicado el borrado físico: se usa archived_at.
--   * Las cantidades nunca pueden ser negativas (CHECK).
-- ---------------------------------------------------------------------------

-- === Configuración institucional ===========================================
-- Par clave/valor. Los valores se validan en la capa de servicios.
CREATE TABLE institution_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- === Usuarios, roles, permisos y sesiones ==================================

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,          -- p.ej. inventory.write
  description TEXT NOT NULL
);

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,      -- admin, inventory_manager, ...
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  archived_at TEXT
);

CREATE TABLE role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email                TEXT UNIQUE COLLATE NOCASE,
  display_name         TEXT,
  password_hash        TEXT NOT NULL,
  password_salt        TEXT NOT NULL,
  password_iterations  INTEGER NOT NULL,
  password_algo        TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  archived_at          TEXT
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Sesiones opacas: se guarda el hash del secreto, nunca el token en claro.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,          -- identificador público de la sesión
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,             -- hash del secreto de sesión
  csrf_secret  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  user_agent   TEXT,
  ip_hash      TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY,
  username   TEXT,
  ip_hash    TEXT,
  success    INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_username ON login_attempts(username, created_at);
CREATE INDEX idx_login_attempts_ip       ON login_attempts(ip_hash, created_at);

-- === Auditoría =============================================================
-- No se registran contraseñas, tokens ni datos personales innecesarios.
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT,
  action        TEXT NOT NULL,           -- auth.login, inventory.assign, ...
  entity_type   TEXT,
  entity_id     TEXT,
  detail        TEXT,                    -- JSON saneado
  ip_hash       TEXT
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);

-- === Objetos de almacenamiento (R2) ========================================
-- R2 es privado por defecto. `is_public` solo para imágenes institucionales
-- aprobadas explícitamente para el sitio público.
CREATE TABLE storage_objects (
  id             INTEGER PRIMARY KEY,
  object_key     TEXT NOT NULL UNIQUE,   -- clave en el bucket R2 (aleatoria)
  original_name  TEXT,
  content_type   TEXT NOT NULL,
  byte_size      INTEGER NOT NULL CHECK (byte_size >= 0),
  width          INTEGER,
  height         INTEGER,
  checksum       TEXT,                   -- p.ej. SHA-256 hex
  is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  alt_text       TEXT,
  caption        TEXT,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  archived_at    TEXT
);
CREATE INDEX idx_storage_public ON storage_objects(is_public);

-- === Catálogos configurables por la institución ============================

CREATE TABLE locations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_archive  INTEGER NOT NULL DEFAULT 0 CHECK (is_archive IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);

CREATE TABLE material_types (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  UNIQUE (category_id, name)
);

-- Condiciones físicas. is_available=1 => disponible para entregar.
CREATE TABLE material_conditions (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 0 CHECK (is_available IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Denominaciones de cargo configurables por institución (sin jerarquía fija).
CREATE TABLE position_types (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);

-- Calidades de integrante (Activo, Abanderado, Aspirante, ...).
CREATE TABLE qualities (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);

-- === Inventario ============================================================

-- Material: el concepto (p.ej. "Casco estructural"), no una unidad física.
CREATE TABLE materials (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  material_type_id INTEGER REFERENCES material_types(id) ON DELETE SET NULL,
  brand            TEXT,
  model            TEXT,
  notes            TEXT,
  min_stock        INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  -- 1 => cada unidad se identifica individualmente (serie/talla).
  is_individual    INTEGER NOT NULL DEFAULT 0 CHECK (is_individual IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  archived_at      TEXT
);
CREATE INDEX idx_materials_name     ON materials(name);
CREATE INDEX idx_materials_category ON materials(category_id);

-- Lote: conjunto de unidades creadas juntas (p.ej. 5 cascos de una compra).
CREATE TABLE lots (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  notes       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_lots_material ON lots(material_id);

-- Unidad física individual (opcional por material).
CREATE TABLE material_units (
  id          INTEGER PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  serial      TEXT,
  size        TEXT,
  lot_id      INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_units_material ON material_units(material_id);
-- Los números de serie no se repiten cuando existen.
CREATE UNIQUE INDEX uq_units_serial
  ON material_units(serial) WHERE serial IS NOT NULL AND serial <> '';

-- Existencias: cantidad de un material en una ubicación con una condición.
-- Es la ÚNICA fuente de verdad de "cuánto hay dónde".
CREATE TABLE stock_levels (
  id             INTEGER PRIMARY KEY,
  material_id    INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  location_id    INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  condition_code TEXT NOT NULL REFERENCES material_conditions(code) ON DELETE RESTRICT,
  quantity       INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at     TEXT NOT NULL,
  UNIQUE (material_id, location_id, condition_code)
);
CREATE INDEX idx_stock_material ON stock_levels(material_id);
CREATE INDEX idx_stock_location ON stock_levels(location_id);

-- === Personas y cargos =====================================================

CREATE TABLE persons (
  id               INTEGER PRIMARY KEY,
  full_name        TEXT NOT NULL,
  rut              TEXT,
  quality_id       INTEGER REFERENCES qualities(id) ON DELETE SET NULL,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  birth_date       TEXT,
  join_date        TEXT,
  registry_no      TEXT,
  emergency_name   TEXT,
  emergency_phone  TEXT,
  history          TEXT,
  photo_object_id  INTEGER REFERENCES storage_objects(id) ON DELETE SET NULL,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  archived_at      TEXT
);
CREATE INDEX idx_persons_name   ON persons(full_name);
CREATE INDEX idx_persons_active ON persons(is_active);

-- Historial de cargos de una persona.
CREATE TABLE person_positions (
  id               INTEGER PRIMARY KEY,
  person_id        INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  position_type_id INTEGER REFERENCES position_types(id) ON DELETE SET NULL,
  position_label   TEXT,                 -- cargo libre si no está catalogado
  start_date       TEXT,
  end_date         TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  archived_at      TEXT
);
CREATE INDEX idx_positions_person ON person_positions(person_id);

-- === Movimientos del inventario ============================================

CREATE TABLE movements (
  id               INTEGER PRIMARY KEY,
  created_at       TEXT NOT NULL,
  movement_type    TEXT NOT NULL,       -- asignacion|devolucion|traslado|baja|
                                        -- cambio_condicion|ingreso_unidad|
                                        -- identificacion_unidad|catastro|ajuste
  material_id      INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  unit_id          INTEGER REFERENCES material_units(id) ON DELETE SET NULL,
  code             TEXT,
  item_name        TEXT,
  quantity         INTEGER NOT NULL CHECK (quantity >= 0),
  from_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  person_id        INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  responsible      TEXT,
  notes            TEXT,
  actor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key  TEXT
);
CREATE INDEX idx_movements_created  ON movements(created_at);
CREATE INDEX idx_movements_material ON movements(material_id);
CREATE INDEX idx_movements_person   ON movements(person_id);

-- === Asignaciones y devoluciones ===========================================

CREATE TABLE assignments (
  id             INTEGER PRIMARY KEY,
  person_id      INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  batch_id       TEXT NOT NULL,          -- agrupa una entrega multi-línea
  delivered_at   TEXT NOT NULL,
  delivered_by   TEXT,
  notes          TEXT,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_assignments_person ON assignments(person_id);
CREATE INDEX idx_assignments_batch  ON assignments(batch_id);

-- Línea de asignación: una unidad lógica (material o unidad física) entregada.
CREATE TABLE assignment_lines (
  id            INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  material_id   INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  unit_id       INTEGER REFERENCES material_units(id) ON DELETE SET NULL,
  code          TEXT NOT NULL,
  item_name     TEXT NOT NULL,
  size          TEXT,
  serial        TEXT,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  returned_qty  INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  condition_out TEXT,
  CHECK (returned_qty <= quantity)
);
CREATE INDEX idx_assignment_lines_assignment ON assignment_lines(assignment_id);
CREATE INDEX idx_assignment_lines_material   ON assignment_lines(material_id);

CREATE TABLE returns (
  id            INTEGER PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  returned_at   TEXT NOT NULL,
  received_by   TEXT,
  to_location_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT,
  notes         TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_returns_person ON returns(person_id);

CREATE TABLE return_lines (
  id                INTEGER PRIMARY KEY,
  return_id         INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  assignment_line_id INTEGER NOT NULL REFERENCES assignment_lines(id) ON DELETE RESTRICT,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  condition_in      TEXT,
  material_id       INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT
);
CREATE INDEX idx_return_lines_return ON return_lines(return_id);

-- === Traslados =============================================================

CREATE TABLE transfers (
  id               INTEGER PRIMARY KEY,
  material_id      INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  from_location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  to_location_id   INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  responsible      TEXT,
  notes            TEXT,
  moved_at         TEXT NOT NULL,
  actor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (from_location_id <> to_location_id)
);
CREATE INDEX idx_transfers_material ON transfers(material_id);
CREATE INDEX idx_transfers_moved_at ON transfers(moved_at);

-- === Bajas =================================================================

CREATE TABLE writeoffs (
  id            INTEGER PRIMARY KEY,
  material_id   INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  unit_id       INTEGER REFERENCES material_units(id) ON DELETE SET NULL,
  code          TEXT,
  item_name     TEXT,
  size          TEXT,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  reason        TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  prior_condition TEXT,
  location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_writeoffs_created ON writeoffs(created_at);

-- === Mantenimiento =========================================================

CREATE TABLE maintenance_records (
  id             INTEGER PRIMARY KEY,
  material_id    INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  unit_id        INTEGER REFERENCES material_units(id) ON DELETE SET NULL,
  performed_at   TEXT NOT NULL,
  kind           TEXT,                   -- inspección / preventiva / correctiva
  result         TEXT,
  resulting_condition TEXT REFERENCES material_conditions(code) ON DELETE SET NULL,
  next_due_at    TEXT,
  responsible    TEXT,
  notes          TEXT,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_maintenance_material ON maintenance_records(material_id);

-- === Idempotencia de operaciones sensibles =================================

CREATE TABLE idempotency_keys (
  key         TEXT PRIMARY KEY,          -- Idempotency-Key del cliente
  scope       TEXT NOT NULL,             -- operación lógica
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  request_hash TEXT,
  response    TEXT,                      -- JSON de la respuesta original
  created_at  TEXT NOT NULL,
  expires_at  TEXT
);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- === Sitio web público (CMS) ===============================================

-- Secciones de la landing: activables, desactivables y ordenables.
CREATE TABLE site_sections (
  id          INTEGER PRIMARY KEY,
  section_key TEXT NOT NULL UNIQUE,      -- hero, history, gallery, news, ...
  is_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  settings    TEXT                       -- JSON de configuración por sección
);

CREATE TABLE pages (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  body          TEXT,                    -- contenido (markdown/HTML saneado)
  excerpt       TEXT,
  hero_object_id INTEGER REFERENCES storage_objects(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  seo_title       TEXT,
  seo_description TEXT,
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_pages_status ON pages(status);

CREATE TABLE news (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT,
  body          TEXT,
  cover_object_id INTEGER REFERENCES storage_objects(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  published_at  TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_news_status ON news(status, published_at);

CREATE TABLE activities (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT,
  body          TEXT,
  starts_at     TEXT,
  ends_at       TEXT,
  location_text TEXT,
  cover_object_id INTEGER REFERENCES storage_objects(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_activities_status ON activities(status, starts_at);

CREATE TABLE galleries (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'archived')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE gallery_photos (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  object_id   INTEGER NOT NULL REFERENCES storage_objects(id) ON DELETE CASCADE,
  caption     TEXT,
  alt_text    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_gallery_photos_gallery ON gallery_photos(gallery_id);

-- Metadatos SEO globales del sitio institucional.
CREATE TABLE seo_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
