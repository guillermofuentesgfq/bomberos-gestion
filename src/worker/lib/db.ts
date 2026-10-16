/**
 * Utilidades de acceso a D1.
 *
 * Reglas del proyecto: SQL siempre parametrizado, ninguna consulta construida
 * con concatenación de valores, y las operaciones que mueven existencias usan
 * `UPDATE` condicionales y `batch()`.
 */

/** Primera fila o `null`. */
export async function first<T>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

/** Todas las filas. */
export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results ?? [];
}

/** Ejecuta una sentencia y devuelve el resultado con metadatos. */
export async function run(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result<unknown>> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** Ejecuta una sentencia y devuelve el número de filas afectadas. */
export async function changedRows(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<number> {
  const result = await run(db, sql, ...params);
  return result.meta.changes ?? 0;
}

/** Ejecuta varias sentencias como una única transacción atómica. */
export async function batch(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result<unknown>[]> {
  return db.batch(statements);
}

/** Construye una sentencia preparada lista para `batch()`. */
export function stmt(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): D1PreparedStatement {
  return db
    .prepare(sql)
    .bind(...params);
}
