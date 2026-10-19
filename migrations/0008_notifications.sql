-- ---------------------------------------------------------------------------
-- 0008 — Notificaciones (bot de Telegram)
--
-- El sistema no envía correo. Cualquier aviso interno (hoy, la llegada de un
-- postulante) se publica en un grupo de Telegram mediante un bot. Quien
-- administra la instalación lo habilita desde Ajustes: el token del bot se
-- guarda **cifrado** (AES-256-GCM) y nunca se devuelve al cliente.
--
-- El `config` de cada canal guarda solo lo no secreto (chat_id, etc.). El token
-- cifrado va en `secret`.
-- ---------------------------------------------------------------------------

CREATE TABLE notification_channels (
  id            INTEGER PRIMARY KEY,
  channel       TEXT NOT NULL UNIQUE,          -- 'telegram'
  is_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  config        TEXT NOT NULL,                  -- JSON sin secretos
  secret        TEXT,                           -- base64(iv || ciphertext)
  include_contact INTEGER NOT NULL DEFAULT 0 CHECK (include_contact IN (0, 1)),
  last_success_at TEXT,
  last_error_at   TEXT,
  last_error      TEXT,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL
);

-- Registro de intentos de entrega, para diagnóstico desde Ajustes.
CREATE TABLE notification_log (
  id         INTEGER PRIMARY KEY,
  channel    TEXT NOT NULL,
  event      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  detail     TEXT,                              -- mensaje de error saneado
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notification_log_created ON notification_log(created_at);
