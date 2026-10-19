/**
 * Cifrado en reposo de secretos de la instalación (por ejemplo, el token del
 * bot de Telegram).
 *
 * Se usa **AES-256-GCM** con una clave derivada por HKDF-SHA256 de
 * `AUTH_SESSION_SECRET`. Así no hace falta un secreto nuevo en el despliegue y
 * el token nunca se guarda en claro en la base: un volcado de D1 no lo revela.
 *
 * Consecuencia que hay que documentar: **rotar `AUTH_SESSION_SECRET` invalida
 * los secretos cifrados**. Al descifrar se devuelve `null` en lugar de lanzar,
 * de modo que la instalación puede volver a pedir el token en Ajustes sin que
 * la aplicación falle.
 *
 * Formato del valor almacenado: `base64(iv || ciphertext || tag)`.
 */

import { AppError } from './errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 12 bytes es el tamaño de nonce recomendado para AES-GCM. */
const IV_BYTES = 12;

/** Etiqueta descriptiva: cambia si el esquema de cifrado cambia. */
const HKDF_INFO = 'bomberos-gestion:notifications:v1';
const HKDF_SALT = 'bomberos-gestion:notifications';

function requireSecret(secret: string | undefined): string {
  if (secret && secret.length >= 16) return secret;
  throw AppError.internal('Falta configurar AUTH_SESSION_SECRET para cifrar secretos.');
}

/** Deriva la clave AES-256 a partir del secreto de sesión de la instalación. */
async function deriveKey(sessionSecret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Cifra un texto y devuelve `base64(iv || ciphertext || tag)`. */
export async function encryptSecret(
  plaintext: string,
  sessionSecret: string | undefined,
): Promise<string> {
  const key = await deriveKey(requireSecret(sessionSecret));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  const cipherBytes = new Uint8Array(cipher);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return toBase64(combined);
}

/**
 * Descifra un valor producido por `encryptSecret`.
 *
 * Devuelve `null` si el valor está corrupto o si la clave cambió (por ejemplo,
 * tras rotar `AUTH_SESSION_SECRET`). Quien llama decide qué hacer: la política
 * es pedir el secreto de nuevo, nunca tumbar la petición.
 */
export async function decryptSecret(
  stored: string,
  sessionSecret: string | undefined,
): Promise<string | null> {
  const secret = sessionSecret ?? '';
  if (secret.length < 16) return null;
  try {
    const combined = fromBase64(stored);
    if (combined.length <= IV_BYTES) return null;
    const iv = combined.slice(0, IV_BYTES);
    const cipher = combined.slice(IV_BYTES);
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return decoder.decode(plain);
  } catch {
    return null;
  }
}
