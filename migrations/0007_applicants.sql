-- ---------------------------------------------------------------------------
-- 0007 — Postulación pública de nuevos integrantes
--
-- El sitio público gana una sección configurable con un formulario. Lo que
-- llega se revisa en el panel, se contacta de forma interna y puede convertirse
-- en ficha de integrante. No hay envío de correo: los avisos van por Telegram
-- (migración 0008).
--
-- `throttle_events` es un limitador genérico por clave (hash de IP), pensado
-- para reutilizarse en cualquier endpoint público con estado.
-- ---------------------------------------------------------------------------

CREATE TABLE applicants (
  id          INTEGER PRIMARY KEY,
  full_name   TEXT NOT NULL,
  rut         TEXT,
  birth_date  TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  commune     TEXT,
  motivation  TEXT,
  availability TEXT,
  status      TEXT NOT NULL DEFAULT 'nuevo'
                CHECK (status IN ('nuevo', 'en_revision', 'contactado', 'entrevista',
                                  'aceptado', 'rechazado', 'archivado')),
  -- Prueba del consentimiento: no se guarda la IP en claro, solo su hash.
  consent_at  TEXT NOT NULL,
  ip_hash     TEXT,
  person_id   INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_applicants_status  ON applicants(status, created_at);
CREATE INDEX idx_applicants_created ON applicants(created_at);
CREATE INDEX idx_applicants_rut     ON applicants(rut);

CREATE TABLE applicant_notes (
  id              INTEGER PRIMARY KEY,
  applicant_id    INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  author_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_applicant_notes_applicant ON applicant_notes(applicant_id, created_at);

-- Bitácora de contacto interno. `email` no está entre los canales: el sistema
-- no envía correo.
CREATE TABLE applicant_contacts (
  id           INTEGER PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('telefono', 'whatsapp', 'presencial', 'otro')),
  summary      TEXT NOT NULL,
  contacted_at TEXT NOT NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_applicant_contacts_applicant ON applicant_contacts(applicant_id, contacted_at);

-- Limitador de peticiones por clave (hash de IP) y ventana.
CREATE TABLE throttle_events (
  id         INTEGER PRIMARY KEY,
  bucket     TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_throttle_lookup ON throttle_events(bucket, key_hash, created_at);

-- Permisos del apartado. No se reutiliza `persons.*` para que revisar
-- postulantes no implique acceso a las fichas del personal.
INSERT OR IGNORE INTO permissions (code, description) VALUES
  ('applicants.read',  'Consultar las postulaciones recibidas'),
  ('applicants.write', 'Gestionar el estado y el contacto de las postulaciones');

-- Administrador (1): todos los permisos, incluidos los nuevos.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
  SELECT 1, code FROM permissions WHERE code IN ('applicants.read', 'applicants.write');

-- Responsable de asignaciones (3): es quien habitualmente recibe postulantes.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  (3, 'applicants.read'),
  (3, 'applicants.write');

-- Sección de la portada para la postulación. Nace desactivada: una instalación
-- que no la configure no publica un formulario vacío.
INSERT INTO site_sections (section_key, is_enabled, sort_order, settings)
VALUES ('apply', 0, 11, '{"title":"Postula a la compañía","intro":"","requirements":"","isOpen":true,"closedMessage":"Las postulaciones están cerradas por ahora.","consentText":"Autorizo el tratamiento de mis datos personales para participar del proceso de postulación.","successMessage":"Recibimos tu postulación. Te contactaremos si tu perfil avanza en el proceso."}');
