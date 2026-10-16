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
  user_id: number | null;
  expires_at: string | null;
}

/** Vigencia de una reserva: si la operación no se completa, la clave se libera. */
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

function expiresAt(): string {
  return new Date(Date.now() + RESERVATION_TTL_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Reserva una clave de idempotencia. Devuelve:
 * - `{ status: 'reserved' }` si es nueva y la operación puede continuar;
 * - `{ status: 'replay', response }` si ya se completó **por el mismo titular**;
 * - `{ status: 'in_flight' }` si otra petición del mismo titular la procesa.
 *
 * La reserva está ligada al titular: la clave de un usuario no se re-entrega a
 * otro (la respuesta almacenada podría ser suya) ni le bloquea la suya. Una
 * reserva caducada (operación abandonada) se reutiliza en vez de bloquear.
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
    `SELECT response, user_id, expires_at FROM idempotency_keys WHERE key = ? AND scope = ?`,
    input.key,
    input.scope,
  );

  if (existing) {
    // La clave es un espacio global: si pertenece a otro titular no se
    // re-entrega ni se bloquea, se rechaza explícitamente.
    if (existing.user_id !== input.userId) {
      throw AppError.conflict('Esa clave de idempotencia ya está en uso por otra operación.');
    }
    if (existing.response) return { status: 'replay', response: existing.response };
    // Reserva abandonada (la operación murió sin liberarla): se reutiliza.
    if (existing.expires_at !== null && existing.expires_at <= nowIso()) {
      await releaseIdempotency(db, input.key, input.scope, input.userId);
    } else {
      return { status: 'in_flight' };
    }
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
      expiresAt(),
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
  userId: number | null,
  response: unknown,
): Promise<void> {
  await run(
    db,
    `UPDATE idempotency_keys SET response = ?
      WHERE key = ? AND scope = ? AND user_id IS ? AND response IS NULL`,
    JSON.stringify(response),
    key,
    scope,
    userId,
  );
}

/**
 * Libera una reserva que no llegó a completarse. Sin esto, una operación que
 * falla (por ejemplo, existencias insuficientes) dejaría la clave «envenenada»:
 * cada reintento recibiría «en curso» para siempre.
 */
export async function releaseIdempotency(
  db: D1Database,
  key: string,
  scope: string,
  userId: number | null,
): Promise<void> {
  await run(
    db,
    `DELETE FROM idempotency_keys WHERE key = ? AND scope = ? AND user_id IS ? AND response IS NULL`,
    key,
    scope,
    userId,
  );
}

/** Error uniforme cuando una operación idempotente está en curso. */
export function inFlightError(): AppError {
  return AppError.conflict('La misma operación se está procesando. Espera un momento.');
}

/**
 * Ejecuta una operación con idempotencia opcional.
 *
 * Sin clave, la operación corre tal cual. Con clave: si ya se completó por el
 * mismo titular se devuelve la respuesta guardada; si la procesa otra petición
 * suya, se responde «en curso»; y si la operación falla, la reserva se libera
 * para que la clave pueda reintentarse.
 */
export async function withIdempotency<T>(
  db: D1Database,
  key: string | null,
  scope: string,
  userId: number | null,
  operation: () => Promise<T>,
): Promise<{ replayed: boolean; response: T }> {
  if (!key) return { replayed: false, response: await operation() };

  const reservation = await reserveIdempotency(db, { key, scope, userId });
  if (reservation.status === 'replay') {
    return { replayed: true, response: JSON.parse(reservation.response) as T };
  }
  if (reservation.status === 'in_flight') throw inFlightError();

  try {
    const response = await operation();
    await saveIdempotencyResponse(db, key, scope, userId, response);
    return { replayed: false, response };
  } catch (error) {
    await releaseIdempotency(db, key, scope, userId);
    throw error;
  }
}
