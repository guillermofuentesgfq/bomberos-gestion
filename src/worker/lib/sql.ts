/** Utilidades para interpretar errores de SQLite/D1. */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** ¿El error es una violación de restricción UNIQUE? */
export function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(errorMessage(error));
}

/**
 * ¿El error es una violación de CHECK?
 *
 * Es importante: las garantías de integridad del inventario se apoyan en
 * `CHECK (quantity >= 0)` y `CHECK (returned_qty <= quantity)`. Un `UPDATE` que
 * dejaría un valor inválido falla y hace que la transacción `batch()` se
 * revierta por completo.
 */
export function isCheckViolation(error: unknown): boolean {
  return /CHECK constraint failed/i.test(errorMessage(error));
}

/** ¿El error es una violación de clave foránea? */
export function isForeignKeyViolation(error: unknown): boolean {
  return /FOREIGN KEY constraint failed/i.test(errorMessage(error));
}

/**
 * Tope de la plataforma: D1 rechaza los patrones `LIKE` de más de **50 bytes**
 * (lo dice su tabla de límites) y el runtime local de las pruebas no lo aplica,
 * así que un término largo pasa la suite y falla en producción. Se recorta el
 * término antes de envolverlo en `%`.
 */
const MAX_LIKE_PATTERN_BYTES = 50;
const LIKE_WILDCARDS_BYTES = 2; // los dos '%' del patrón

/** Recorta por bytes UTF-8, sin partir un carácter. */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let used = 0;
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

/** Quita una barra de escape que haya quedado al final tras recortar. */
function trimTrailingEscape(value: string): string {
  let trailing = 0;
  while (trailing < value.length && value[value.length - 1 - trailing] === '\\') trailing += 1;
  return trailing % 2 === 1 ? value.slice(0, value.length - 1) : value;
}

/**
 * Patrón `LIKE` con el texto escapado y acotado: los comodines que escriba el
 * usuario (`%`, `_`) y la propia barra de escape se tratan como literales, de
 * modo que escribir `%` no coincide con todo. Se usa junto a
 * `LIKE ? ESCAPE '\'`.
 *
 * El recorte se hace **después** de escapar (escapar alarga el texto) y nunca
 * deja una barra de escape suelta al final, que SQLite rechazaría.
 */
export function likePattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
  const room = MAX_LIKE_PATTERN_BYTES - LIKE_WILDCARDS_BYTES;
  return `%${trimTrailingEscape(truncateToBytes(escaped, room))}%`;
}
