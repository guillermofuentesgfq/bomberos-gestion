import type { Context } from 'hono';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { hmacSha256Hex } from '../lib/crypto';

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Hash de la IP del cliente. Nunca se guarda la IP en claro: se aplica HMAC con
 * el secreto de sesión de la instalación.
 *
 * `cf-connecting-ip` la fija el borde de Cloudflare y no la puede elegir el
 * cliente. El respaldo `x-forwarded-for` **sí** la puede falsificar cualquiera,
 * así que solo se admite en desarrollo local: en producción, no tener
 * `cf-connecting-ip` significa «IP desconocida», no «la que diga la cabecera».
 * De lo contrario bastaría con rotar la cabecera para que el límite de intentos
 * por IP no se disparara nunca.
 */
export async function clientIpHash(c: AppContext): Promise<string> {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip =
    c.req.header('cf-connecting-ip') ??
    (c.env.APP_ENV === 'development' ? forwarded : undefined) ??
    'unknown';
  return hmacSha256Hex(requireSessionSecret(c.env), `ip:${ip}`);
}

/**
 * Secreto con el que se derivan los hashes de IP (y la firma de sesiones). Es
 * obligatorio: sin él, los hashes serían reversibles por diccionario. Solo en
 * desarrollo local (y en las pruebas) se admite un valor de relleno.
 */
function requireSessionSecret(env: Env): string {
  const secret = env.AUTH_SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (env.APP_ENV === 'development') return 'insecure-development-secret';
  throw AppError.internal('Falta configurar AUTH_SESSION_SECRET en este entorno.');
}

/** Encabezado del token CSRF exigido en operaciones con estado. */
export const CSRF_HEADER = 'x-csrf-token';
