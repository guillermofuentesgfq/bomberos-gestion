import { run } from '../lib/db';
import { nowIso } from '../lib/time';

export interface AuditEntry {
  actorUserId?: number | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  /** Detalle saneado. Nunca incluir contraseñas, tokens ni datos sensibles. */
  detail?: unknown;
  ipHash?: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'password_salt',
  'token',
  'token_hash',
  'csrf',
  'csrf_secret',
  'secret',
  'authorization',
  'cookie',
]);

/** Elimina claves sensibles de un detalle antes de guardarlo. */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitize(val, depth + 1);
    }
  }
  return out;
}

/**
 * Registra una entrada de auditoría. Es tolerante a fallos: un error al
 * auditar no debe tumbar la operación de negocio ya confirmada.
 */
export async function logAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await run(
      db,
      `INSERT INTO audit_log
         (created_at, actor_user_id, actor_label, action, entity_type, entity_id, detail, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      entry.actorUserId ?? null,
      entry.actorLabel ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
      entry.detail === undefined ? null : JSON.stringify(sanitize(entry.detail)),
      entry.ipHash ?? null,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'warn',
        message: 'audit_write_failed',
        action: entry.action,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}
