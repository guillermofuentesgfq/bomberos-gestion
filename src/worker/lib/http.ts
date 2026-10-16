import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from './errors';

/**
 * Respuesta JSON uniforme de éxito.
 *
 * Se construye con `c.json()` para que Hono mezcle las cabeceras preparadas en
 * el contexto (por ejemplo, `Set-Cookie`). Crear un `Response` nuevo a mano las
 * perdería.
 */
export function ok<T>(
  c: Context,
  data: T,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json({ ok: true as const, data }, status);
}

/** Respuesta JSON uniforme de error. */
export function fail(c: Context, error: AppError): Response {
  return c.json(
    {
      ok: false as const,
      error: {
        code: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
    },
    error.status as ContentfulStatusCode,
  );
}
