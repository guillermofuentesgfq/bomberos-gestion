/**
 * Primitivas criptográficas basadas en WebCrypto (disponibles en Workers).
 *
 * Contraseñas: PBKDF2-SHA256 con sal única por usuario, seguido de un HMAC con
 * el secreto `pepper` de la instalación. El `pepper` no se guarda en la base.
 */

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Comparación en tiempo constante de dos cadenas hex. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Comparación en tiempo constante de dos cadenas cualesquiera. */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return toHex(new Uint8Array(signature));
}

/**
 * Iteraciones de PBKDF2-HMAC-SHA256 para las contraseñas.
 *
 * **Tope de la plataforma.** El runtime de Cloudflare rechaza cualquier cifra por
 * encima de 100 000 (`Pbkdf2 failed: iteration counts above 100000 are not
 * supported`). Se usaban 210 000: el runtime local de las pruebas **no** aplica
 * ese tope, así que pasó la suite entera y falló en el primer despliegue real,
 * al crear el primer administrador. No se sube de aquí sin comprobarlo en un
 * despliegue de verdad.
 *
 * Queda por debajo de la recomendación de OWASP (600 000) porque la plataforma
 * no lo permite; lo compensan el *pepper* por instalación —un secreto que vive
 * en el Worker y no en la base, así que un volcado de datos no basta para atacar
 * los hashes—, el mínimo de 12 caracteres para la contraseña, el bloqueo por
 * intentos y el límite por IP.
 *
 * **Coste:** medido en el runtime de las pruebas, 100 000 iteraciones cuestan
 * unos 5 ms de CPU. En el plan gratuito de Workers el tope es de 10 ms por
 * petición, así que el acceso va justo: por eso el asistente de arranque abre la
 * sesión sin volver a derivar la contraseña que acaba de hashear. Si un
 * despliegue con mucho tráfico de acceso empieza a devolver el error 1102, la
 * salida es el plan de pago (30 s de CPU) o bajar esta cifra, nunca subirla.
 */
export const PASSWORD_ITERATIONS = 100_000;

/** Deriva el hash de una contraseña. Devuelve hex. */
export async function derivePasswordHash(
  password: string,
  saltHex: string,
  pepper: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const derivedHex = toHex(new Uint8Array(bits));
  // El pepper se aplica como HMAC separado, de modo que nunca entra en la sal.
  return hmacSha256Hex(pepper, derivedHex);
}

/** Genera una sal hexadecimal de 16 bytes. */
export function generateSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}