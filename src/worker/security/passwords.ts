import {
  PASSWORD_ITERATIONS,
  constantTimeEqualHex,
  derivePasswordHash,
  generateSaltHex,
} from '../lib/crypto';

/** Contraseña tal como se guarda en la tabla `users`. */
export interface StoredPassword {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_algo: string;
}

export interface HashedPassword {
  hash: string;
  salt: string;
  iterations: number;
  algo: string;
}

const ALGO = 'PBKDF2-SHA256+HMAC';

/** Longitud mínima exigida a cualquier contraseña. */
export const MIN_PASSWORD_LENGTH = 12;

export function isPasswordAcceptable(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** Hashea una contraseña con sal nueva y el pepper de la instalación. */
export async function hashPassword(password: string, pepper: string): Promise<HashedPassword> {
  const salt = generateSaltHex();
  const hash = await derivePasswordHash(password, salt, pepper, PASSWORD_ITERATIONS);
  return { hash, salt, iterations: PASSWORD_ITERATIONS, algo: ALGO };
}

/** Verifica una contraseña contra el registro almacenado, en tiempo constante. */
export async function verifyPassword(
  password: string,
  stored: StoredPassword,
  pepper: string,
): Promise<boolean> {
  if (stored.password_algo !== ALGO) return false;
  const candidate = await derivePasswordHash(
    password,
    stored.password_salt,
    pepper,
    stored.password_iterations,
  );
  return constantTimeEqualHex(candidate, stored.password_hash);
}
