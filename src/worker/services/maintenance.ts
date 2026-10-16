import { run } from '../lib/db';
import { addSeconds, nowIso } from '../lib/time';

/**
 * Limpieza periódica de datos caducados.
 *
 * Varias tablas solo crecían: las sesiones caducadas o revocadas se marcaban
 * pero no se borraban nunca, las tentativas de ingreso se guardaban para la
 * ventana de 15 minutos y se quedaban para siempre, y las reservas de
 * idempotencia caducaban sin que nadie las retirara. El cron del Worker llama a
 * esta función una vez al día.
 *
 * El registro de auditoría **no** se purga: es el rastro forense de la
 * instalación y su retención la decide el operador (puede exportarlo o
 * recortarlo por su cuenta). Aquí solo se limpia lo que ya no sirve.
 */

/** Retención de sesiones caducadas o revocadas y de intentos de ingreso. */
const RETENTION_DAYS = 30;

export interface PurgeSummary {
  sessions: number;
  loginAttempts: number;
  idempotencyKeys: number;
}

/** Borra filas caducadas y devuelve cuántas de cada tabla. */
export async function purgeStaleData(db: D1Database): Promise<PurgeSummary> {
  const now = nowIso();
  const cutoff = addSeconds(now, -RETENTION_DAYS * 24 * 60 * 60);

  // Sesiones que caducaron hace tiempo o que se revocaron hace tiempo.
  const sessions = await run(
    db,
    `DELETE FROM sessions
      WHERE (expires_at < ?) OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
    cutoff,
    cutoff,
  );

  const loginAttempts = await run(
    db,
    `DELETE FROM login_attempts WHERE created_at < ?`,
    cutoff,
  );

  // Las reservas de idempotencia se retiran en cuanto caducan.
  const idempotencyKeys = await run(
    db,
    `DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at < ?`,
    now,
  );

  return {
    sessions: sessions.meta.changes ?? 0,
    loginAttempts: loginAttempts.meta.changes ?? 0,
    idempotencyKeys: idempotencyKeys.meta.changes ?? 0,
  };
}
