/**
 * Notificaciones internas de la instalación.
 *
 * El sistema **no envía correo**: los avisos se publican en un grupo de
 * Telegram mediante un bot. Quien administra la instalación lo habilita desde
 * Ajustes; el token se guarda cifrado (`lib/secrets.ts`) y nunca se devuelve al
 * cliente.
 *
 * Dos reglas que sostienen la función:
 *   1. **Nunca lanza.** Un aviso que falla no puede tumbar la operación que lo
 *      originó (registrar un postulante). El fallo se guarda en el canal y en
 *      `notification_log` para verlo desde Ajustes.
 *   2. **Texto plano.** El mensaje no usa `parse_mode`: los datos que llegan
 *      del público se publican tal cual, sin interpretar marcado. Así no hay
 *      forma de inyectar enlaces o formato en el grupo.
 */

import { all, first, run } from '../lib/db';
import { nowIso } from '../lib/time';
import { AppError } from '../lib/errors';
import { logAudit } from '../security/audit';
import { decryptSecret, encryptSecret } from '../lib/secrets';
import type { Actor } from '../security/actor';

export const TELEGRAM_CHANNEL = 'telegram';

/** Tope del mensaje: Telegram rechaza por encima de 4096 caracteres. */
const MAX_MESSAGE_LENGTH = 3500;

/** Tiempo máximo de espera a la API de Telegram. */
const TELEGRAM_TIMEOUT_MS = 5000;

export interface NotificationChannelRow {
  id: number;
  channel: string;
  is_enabled: number;
  config: string;
  secret: string | null;
  include_contact: number;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface TelegramConfig {
  chatId: string;
}

/** Configuración pública del canal: nunca incluye el token. */
export interface NotificationSettings {
  enabled: boolean;
  chatId: string;
  hasToken: boolean;
  includeContact: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

function parseConfig(raw: string): TelegramConfig {
  try {
    const parsed = JSON.parse(raw) as Partial<TelegramConfig>;
    return { chatId: typeof parsed.chatId === 'string' ? parsed.chatId : '' };
  } catch {
    return { chatId: '' };
  }
}

async function findChannel(db: D1Database): Promise<NotificationChannelRow | null> {
  return first<NotificationChannelRow>(
    db,
    `SELECT id, channel, is_enabled, config, secret, include_contact,
            last_success_at, last_error_at, last_error, updated_at
       FROM notification_channels WHERE channel = ?`,
    TELEGRAM_CHANNEL,
  );
}

/** Estado del canal para la pantalla de Ajustes. */
export async function getNotificationSettings(db: D1Database): Promise<NotificationSettings> {
  const row = await findChannel(db);
  if (!row) {
    return {
      enabled: false,
      chatId: '',
      hasToken: false,
      includeContact: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    };
  }
  return {
    enabled: row.is_enabled === 1,
    chatId: parseConfig(row.config).chatId,
    hasToken: row.secret !== null && row.secret.length > 0,
    includeContact: row.include_contact === 1,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
  };
}

export interface SaveTelegramInput {
  enabled: boolean;
  chatId: string;
  includeContact: boolean;
  /** Token nuevo. Si se omite, se conserva el guardado. */
  token?: string | undefined;
}

/** Guarda la configuración del canal. El token, si viene, se cifra. */
export async function saveTelegramSettings(
  db: D1Database,
  sessionSecret: string | undefined,
  input: SaveTelegramInput,
  actor: Actor,
): Promise<NotificationSettings> {
  const existing = await findChannel(db);
  const chatId = input.chatId.trim();

  if (input.enabled && chatId.length === 0) {
    throw AppError.unprocessable('Para activar las notificaciones indica el identificador del grupo.');
  }
  if (input.enabled && !input.token && !(existing?.secret)) {
    throw AppError.unprocessable('Para activar las notificaciones indica el token del bot.');
  }

  let secret = existing?.secret ?? null;
  if (input.token !== undefined && input.token.trim().length > 0) {
    secret = await encryptSecret(input.token.trim(), sessionSecret);
  }

  const config = JSON.stringify({ chatId });
  const now = nowIso();

  if (existing) {
    await run(
      db,
      `UPDATE notification_channels
          SET is_enabled = ?, config = ?, secret = ?, include_contact = ?, updated_by = ?, updated_at = ?
        WHERE channel = ?`,
      input.enabled ? 1 : 0,
      config,
      secret,
      input.includeContact ? 1 : 0,
      actor.userId,
      now,
      TELEGRAM_CHANNEL,
    );
  } else {
    await run(
      db,
      `INSERT INTO notification_channels
         (channel, is_enabled, config, secret, include_contact, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      TELEGRAM_CHANNEL,
      input.enabled ? 1 : 0,
      config,
      secret,
      input.includeContact ? 1 : 0,
      actor.userId,
      now,
    );
  }

  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'notifications.telegram_saved',
    entityType: 'notification_channel',
    entityId: TELEGRAM_CHANNEL,
    // El token nunca entra al detalle de auditoría.
    detail: { enabled: input.enabled, hasChatId: chatId.length > 0, tokenRotated: Boolean(input.token) },
    ipHash: actor.ipHash,
  });

  return getNotificationSettings(db);
}

/** Borra el token guardado (por ejemplo, tras rotar el secreto de sesión). */
export async function clearTelegramToken(
  db: D1Database,
  actor: Actor,
): Promise<NotificationSettings> {
  await run(
    db,
    `UPDATE notification_channels SET secret = NULL, is_enabled = 0, updated_by = ?, updated_at = ?
      WHERE channel = ?`,
    actor.userId,
    nowIso(),
    TELEGRAM_CHANNEL,
  );
  await logAudit(db, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'notifications.telegram_token_cleared',
    entityType: 'notification_channel',
    entityId: TELEGRAM_CHANNEL,
    ipHash: actor.ipHash,
  });
  return getNotificationSettings(db);
}

/**
 * ¿El canal activo quiere incluir el contacto del postulante en el aviso?
 *
 * Por defecto es `false`: el grupo de Telegram es un tercero y solo debe recibir
 * el mínimo para poder actuar (nombre y comuna, más el enlace al panel).
 */
export async function channelIncludesContact(db: D1Database): Promise<boolean> {
  const row = await findChannel(db);
  return row !== null && row.is_enabled === 1 && row.include_contact === 1;
}

/** Registro de intentos de entrega, más reciente primero. */
export async function listNotificationLog(
  db: D1Database,
  limit = 20,
): Promise<{ id: number; channel: string; event: string; status: string; detail: string | null; created_at: string }[]> {
  return all(
    db,
    `SELECT id, channel, event, status, detail, created_at
       FROM notification_log ORDER BY id DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 100),
  );
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/** Redacta el token de la URL si aparece en un mensaje de error. */
function redactToken(text: string): string {
  return text.replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot<token>');
}

interface TelegramResult {
  ok: boolean;
  detail: string;
}

async function callTelegram(token: string, method: string, body: unknown): Promise<TelegramResult> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok) return { ok: true, detail: 'ok' };
    // El detalle de Telegram puede ser útil (chat no encontrado, token
    // inválido), pero nunca puede llevar el token.
    return { ok: false, detail: redactToken(text.slice(0, 300)) };
  } catch (error) {
    return {
      ok: false,
      detail: redactToken(error instanceof Error ? error.message : 'error de red'),
    };
  }
}

async function recordDelivery(
  db: D1Database,
  event: string,
  status: 'sent' | 'failed' | 'skipped',
  detail: string | null,
): Promise<void> {
  await run(
    db,
    `INSERT INTO notification_log (channel, event, status, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
    TELEGRAM_CHANNEL,
    event,
    status,
    detail,
    nowIso(),
  );
  if (status === 'sent') {
    await run(
      db,
      `UPDATE notification_channels SET last_success_at = ?, last_error = NULL, last_error_at = NULL
        WHERE channel = ?`,
      nowIso(),
      TELEGRAM_CHANNEL,
    );
  } else if (status === 'failed') {
    await run(
      db,
      `UPDATE notification_channels SET last_error = ?, last_error_at = ? WHERE channel = ?`,
      detail,
      nowIso(),
      TELEGRAM_CHANNEL,
    );
  }
}

export interface NotifyInput {
  event: string;
  text: string;
}

/**
 * Envía un aviso por Telegram si el canal está activo.
 *
 * **No lanza nunca**: cualquier fallo se registra y se devuelve `false`. Se
 * invoca desde `ctx.waitUntil()` para no retrasar la respuesta al usuario.
 */
export async function notify(
  env: { DB: D1Database; AUTH_SESSION_SECRET?: string | undefined },
  input: NotifyInput,
): Promise<boolean> {
  try {
    const channel = await findChannel(env.DB);
    if (!channel || channel.is_enabled !== 1) {
      return false;
    }
    if (!channel.secret) {
      await recordDelivery(env.DB, input.event, 'failed', 'El canal no tiene token configurado.');
      return false;
    }
    const token = await decryptSecret(channel.secret, env.AUTH_SESSION_SECRET);
    if (token === null) {
      await recordDelivery(
        env.DB,
        input.event,
        'failed',
        'No se pudo descifrar el token. Vuelve a guardarlo en Ajustes.',
      );
      return false;
    }

    const chatId = parseConfig(channel.config).chatId;
    if (chatId.length === 0) {
      await recordDelivery(env.DB, input.event, 'failed', 'Falta el identificador del grupo.');
      return false;
    }

    const result = await callTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text: input.text.slice(0, MAX_MESSAGE_LENGTH),
      disable_web_page_preview: true,
    });
    await recordDelivery(env.DB, input.event, result.ok ? 'sent' : 'failed', result.ok ? null : result.detail);
    return result.ok;
  } catch (error) {
    try {
      await recordDelivery(
        env.DB,
        input.event,
        'failed',
        redactToken(error instanceof Error ? error.message : 'error inesperado'),
      );
    } catch {
      // Si ni siquiera se puede registrar, se descarta: la operación de negocio
      // no puede fallar por una notificación.
    }
    return false;
  }
}

/** Envía un mensaje de prueba y devuelve el resultado real para la pantalla. */
export async function sendTestMessage(
  env: { DB: D1Database; AUTH_SESSION_SECRET?: string | undefined },
  actor: Actor,
): Promise<{ ok: boolean; detail: string }> {
  const channel = await findChannel(env.DB);
  if (!channel) throw AppError.unprocessable('El canal de Telegram todavía no está configurado.');
  if (!channel.secret) throw AppError.unprocessable('Falta guardar el token del bot.');

  const token = await decryptSecret(channel.secret, env.AUTH_SESSION_SECRET);
  if (token === null) {
    throw AppError.unprocessable('No se pudo descifrar el token. Vuelve a guardarlo.');
  }
  const chatId = parseConfig(channel.config).chatId;
  if (chatId.length === 0) throw AppError.unprocessable('Falta el identificador del grupo.');

  const result = await callTelegram(token, 'sendMessage', {
    chat_id: chatId,
    text: 'Mensaje de prueba de bomberos-gestion. Si lo ves, las notificaciones funcionan.',
    disable_web_page_preview: true,
  });
  await recordDelivery(env.DB, 'test', result.ok ? 'sent' : 'failed', result.ok ? null : result.detail);
  await logAudit(env.DB, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: 'notifications.telegram_test',
    entityType: 'notification_channel',
    entityId: TELEGRAM_CHANNEL,
    detail: { ok: result.ok },
    ipHash: actor.ipHash,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Mensajes por evento
// ---------------------------------------------------------------------------

export interface ApplicantNotification {
  fullName: string;
  commune: string | null;
  email: string | null;
  phone: string | null;
  motivation: string | null;
  applicantId: number;
  /** Origen del sitio, para enlazar al panel. */
  origin: string;
}

/** Texto del aviso de un postulante nuevo. */
export function applicantMessage(input: ApplicantNotification, includeContact: boolean): string {
  const lines = [`Nueva postulación: ${input.fullName}`];
  if (input.commune) lines.push(`Comuna: ${input.commune}`);
  if (includeContact && input.phone) lines.push(`Teléfono: ${input.phone}`);
  if (includeContact && input.email) lines.push(`Correo: ${input.email}`);
  if (input.motivation) {
    const excerpt = input.motivation.length > 300 ? `${input.motivation.slice(0, 297)}…` : input.motivation;
    lines.push('', excerpt);
  }
  lines.push('', `Revisar en el panel: ${input.origin}/admin/postulantes/${input.applicantId}`);
  return lines.join('\n');
}
