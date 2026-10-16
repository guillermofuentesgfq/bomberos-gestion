import { constantTimeEqual } from '../lib/crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Los métodos seguros no modifican estado y no requieren token CSRF. */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Comprueba el token CSRF enviado en la cabecera contra el secreto de la
 * sesión. Se compara en tiempo constante.
 */
export function csrfMatches(headerValue: string | undefined, sessionToken: string): boolean {
  if (!headerValue || !sessionToken) return false;
  return constantTimeEqual(headerValue, sessionToken);
}
