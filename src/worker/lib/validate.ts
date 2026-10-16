import type { z } from 'zod';
import type { Context } from 'hono';
import { AppError, type FieldIssue } from './errors';

/** Convierte un error de Zod en un error de aplicación con detalle por campo. */
export function validationError(error: z.ZodError): AppError {
  const issues: FieldIssue[] = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  return AppError.unprocessable('Datos inválidos.', issues);
}

/** Lee y valida el cuerpo JSON de la petición. */
export async function readJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest('El cuerpo debe ser JSON válido.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Valida un objeto ya disponible (p. ej. parámetros de formulario). */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
