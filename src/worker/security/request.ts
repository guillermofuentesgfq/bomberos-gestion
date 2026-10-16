import type { Context } from 'hono';
import type { Env, Variables } from '../lib/env';
import { hmacSha256Hex } from '../lib/crypto';

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Hash de la IP del cliente. Nunca se guarda la IP en claro: se aplica HMAC con
 * el secreto de sesión de la instalación.
 */
export async function clientIpHash(c: AppContext): Promise<string> {
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const secret = c.env.AUTH_SESSION_SECRET ?? 'insecure-development-secret';
  return hmacSha256Hex(secret, `ip:${ip}`);
}

/** Encabezado del token CSRF exigido en operaciones con estado. */
export const CSRF_HEADER = 'x-csrf-token';
