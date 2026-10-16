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
