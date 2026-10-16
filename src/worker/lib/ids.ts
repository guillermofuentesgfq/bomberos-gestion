/** Genera `length` bytes aleatorios criptográficamente seguros. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Codifica bytes en base64url sin relleno. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Token aleatorio en base64url. Por defecto 32 bytes (256 bits). */
export function randomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength));
}

/** Identificador hexadecimal aleatorio. */
export function randomId(byteLength = 16): string {
  return Array.from(randomBytes(byteLength), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Slug legible para URLs a partir de un texto libre. Apto para acentos y ñ.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
