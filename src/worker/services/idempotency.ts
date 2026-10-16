import { first, run } from '../lib/db';
import { nowIso } from '../lib/time';
import { AppError } from '../lib/errors';
import { isUniqueViolation } from '../lib/sql';

export interface IdempotencyScope {
  key: string;
  scope: string;
  userId: number | null;
}

interface IdempotencyRow {
  response: string | null;
}

/**
 * Reserva una clave de idempotencia. Devuelve:
 * - `{ status: 'reserved' }` si es nueva y la operación puede continuar;
 * - `{ status: 'replay', response }` si ya se completó (se devuelve la respuesta original);
 * - `{ status: 'in_flight' }` si otra petición la está procesando.
 */
export type ReserveResult =
  | { status: 'reserved' }
  | { status: 'replay'; response: string }
  | { status: 'in_flight' };

export async function reserveIdempotency(
  db: D1Database,
  input: IdempotencyScope,
): Promise<ReserveResult> {
  const existing = await first<IdempotencyRow>(
    db,
    `SELECT response FROM idempotency_keys WHERE key = ? AND scope = ?`,
    input.key,
    input.scope,
  );
  if (existing) {
    if (existing.response) return { status: 'replay', response: existing.response };
    return { status: 'in_flight' };
  }

  try {
    await run(
      db,
      `INSERT INTO idempotency_keys (key, scope, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      input.key,
      input.scope,
      input.userId,
      nowIso(),
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
    return { status: 'reserved' };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Otra petición la reservó justo antes.
      return { status: 'in_flight' };
    }
    throw error;
  }
}

/** Guarda la respuesta de una operación idempotente ya completada. */
export async function saveIdempotencyResponse(
  db: D1Database,
  key: string,
  scope: string,
  response: unknown,
): Promise<void> {
  await run(
    db,
    `UPDATE idempotency_keys SET response = ? WHERE key = ? AND scope = ?`,
    JSON.stringify(response),
    key,
    scope,
  );
}

/** Error uniforme cuando una operación idempotente está en curso. */
export function inFlightError(): AppError {
  return AppError.conflict('La misma operación se está procesando. Espera un momento.');
}
