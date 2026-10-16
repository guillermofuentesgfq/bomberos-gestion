import type { z } from 'zod';
import type { Context } from 'hono';
import { AppError, type FieldIssue } from './errors';

/** Tope de cuerpo para los endpoints JSON (las subidas usan su propio límite). */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Convierte un error de Zod en un error de aplicación con detalle por campo. */
export function validationError(error: z.ZodError): AppError {
  const issues: FieldIssue[] = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  return AppError.unprocessable('Datos inválidos.', issues);
}

/**
 * Lee el cuerpo con un contador de bytes: el tope se aplica sobre lo que se
 * recibe de verdad, no sobre la cabecera `content-length` que declara el
 * cliente. Una petición sin esa cabecera (o con una mentira) no puede colar un
 * cuerpo desmesurado antes de que el parser lo cargue en memoria.
 */
async function readBodyWithinLimit(c: Context, maxBytes: number): Promise<string> {
  const body = c.req.raw.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw AppError.payloadTooLarge('El cuerpo de la petición es demasiado grande.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Lee y valida el cuerpo JSON de la petición.
 *
 * Exige `content-type: application/json`. Sin esa comprobación, un formulario
 * HTML de otro sitio con `enctype="text/plain"` y un cuerpo con forma de JSON
 * llegaría al parser (el `json()` de Hono no mira el tipo de contenido), que es
 * la forma de una petición cruzada sin preflight.
 */
export async function readJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw AppError.unsupportedMediaType('El cuerpo debe enviarse como application/json.');
  }

  const text = await readBodyWithinLimit(c, MAX_JSON_BODY_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
