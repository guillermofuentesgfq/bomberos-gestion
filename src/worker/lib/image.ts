/**
 * Validación de imágenes a nivel de bytes.
 *
 * No depende de APIs de navegador (`Image`, `createImageBitmap`): interpreta
 * las cabeceras binarias para determinar el formato real y sus dimensiones. De
 * este modo el tipo declarado por el cliente nunca se da por bueno.
 */

/** Formatos de imagen aceptados por la plataforma. */
export type ImageType = 'png' | 'jpeg' | 'webp';

/** Tamaño máximo de una imagen almacenada (5 MiB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Dimensión máxima permitida en píxeles (ancho o alto). */
export const MAX_IMAGE_DIMENSION = 8000;

const MIME_BY_TYPE: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EXTENSION_BY_TYPE: Record<ImageType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

/** Sinónimos de tipo MIME que se aceptan como equivalentes. */
const MIME_ALIASES: Record<string, ImageType> = {
  'image/png': 'png',
  'image/x-png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/webp': 'webp',
};

/** Tipo MIME canónico para un formato detectado. */
export function mimeForImageType(type: ImageType): string {
  return MIME_BY_TYPE[type];
}

/** Extensión de archivo (sin punto) para un formato detectado. */
export function extensionForImageType(type: ImageType): string {
  return EXTENSION_BY_TYPE[type];
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

/** Comprueba la firma PNG: 89 50 4E 47 0D 0A 1A 0A. */
function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Comprueba la firma JPEG: FF D8 FF. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Comprueba el contenedor RIFF/WEBP: "RIFF"…"WEBP". */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp;
}

/** Detecta el formato real a partir de los bytes mágicos. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (isPng(bytes)) return 'png';
  if (isJpeg(bytes)) return 'jpeg';
  if (isWebp(bytes)) return 'webp';
  return null;
}

/** Contenido que parece SVG (contenido activo: nunca se acepta). */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .toLowerCase();
  if (head.includes('<svg')) return true;
  return head.includes('<?xml') && head.includes('<svg');
}

/** Contenido GIF (GIF87a / GIF89a). */
function looksLikeGif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  );
}

function dimensionsFromPng(bytes: Uint8Array): { width: number; height: number } | null {
  // Firma (8) + longitud IHDR (4) + tipo IHDR (4) = 16 antes del cuerpo.
  if (bytes.length < 24) return null;
  const chunkLength = readU32BE(bytes, 8);
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (chunkLength !== 13 || !isIhdr) return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width === null || height === null) return null;
  return { width, height };
}

/** Marcadores SOF (inicio de marco) que llevan las dimensiones. */
function isStartOfFrame(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  // 0xC4 (DHT), 0xC8 (JPG) y 0xCC (DAC) comparten rango pero no son SOF.
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function dimensionsFromJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2; // tras el SOI (FF D8)
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1] ?? 0;
    offset += 2;
    // Saltar bytes de relleno 0xFF.
    while (marker === 0xff && offset < bytes.length) {
      marker = bytes[offset] ?? 0;
      offset += 1;
    }

    // Marcadores sin segmento de longitud.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (marker === 0xd9) return null; // EOI sin haber visto SOF
      continue;
    }
    // Inicio del escaneo: los datos comprimidos ya no son marcadores.
    if (marker === 0xda) return null;

    const segmentLength = readU16BE(bytes, offset);
    if (segmentLength === null || segmentLength < 2) return null;

    if (isStartOfFrame(marker)) {
      // longitud (2) + precisión (1) + alto (2) + ancho (2).
      if (offset + 7 > bytes.length) return null;
      const height = readU16BE(bytes, offset + 3);
      const width = readU16BE(bytes, offset + 5);
      if (width === null || height === null) return null;
      return { width, height };
    }

    offset += segmentLength;
  }
  return null;
}

function dimensionsFromWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 16) return null;
  const fourcc = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  const base = 20; // inicio de los datos del chunk

  if (fourcc === 'VP8 ') {
    // Lossy: 3 bytes de cabecera de marco + código de inicio 9D 01 2A.
    if (bytes.length < base + 10) return null;
    if ((bytes[base + 3] ?? 0) !== 0x9d) return null;
    if ((bytes[base + 4] ?? 0) !== 0x01) return null;
    if ((bytes[base + 5] ?? 0) !== 0x2a) return null;
    const width = readU16LE(bytes, base + 6) & 0x3fff;
    const height = readU16LE(bytes, base + 8) & 0x3fff;
    return { width, height };
  }

  if (fourcc === 'VP8L') {
    // Lossless: firma 2F y 4 bytes con (ancho-1) y (alto-1) empaquetados.
    if (bytes.length < base + 5) return null;
    if ((bytes[base] ?? 0) !== 0x2f) return null;
    const b0 = bytes[base + 1] ?? 0;
    const b1 = bytes[base + 2] ?? 0;
    const b2 = bytes[base + 3] ?? 0;
    const b3 = bytes[base + 4] ?? 0;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  if (fourcc === 'VP8X') {
    // Extended: 1 byte de flags + 3 reservados + liana (3+3), todo -1.
    if (bytes.length < base + 10) return null;
    const width = 1 + readU24LE(bytes, base + 4);
    const height = 1 + readU24LE(bytes, base + 7);
    return { width, height };
  }

  return null;
}

/** Lee las dimensiones reales de una imagen ya identificada. */
export function readImageDimensions(
  bytes: Uint8Array,
  type: ImageType,
): { width: number; height: number } | null {
  switch (type) {
    case 'png':
      return dimensionsFromPng(bytes);
    case 'jpeg':
      return dimensionsFromJpeg(bytes);
    case 'webp':
      return dimensionsFromWebp(bytes);
  }
}

function normalizeDeclaredType(declaredType: string): ImageType | null {
  return MIME_ALIASES[declaredType.trim().toLowerCase()] ?? null;
}

export type ImageValidation =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; reason: string };

/**
 * Valida que `bytes` sea una imagen permitida y legible.
 *
 * Rechaza contenido que no es imagen, formatos no permitidos (GIF, SVG y
 * cualquier contenido activo), archivos que superan `MAX_IMAGE_BYTES`,
 * dimensiones ilegibles o mayores que `MAX_IMAGE_DIMENSION`, y discrepancias
 * entre el tipo declarado y el contenido real.
 */
export function validateImageFile(
  bytes: Uint8Array,
  declaredType?: string,
): ImageValidation {
  if (bytes.length === 0) {
    return { ok: false, reason: 'El archivo está vacío.' };
  }
  if (looksLikeSvg(bytes)) {
    return { ok: false, reason: 'Las imágenes SVG no están permitidas (contenido activo).' };
  }
  if (looksLikeGif(bytes)) {
    return { ok: false, reason: 'El formato GIF no está permitido. Usa PNG, JPEG o WebP.' };
  }

  const type = detectImageType(bytes);
  if (!type) {
    return { ok: false, reason: 'El contenido no es una imagen PNG, JPEG o WebP válida.' };
  }

  if (declaredType && declaredType.trim().length > 0) {
    const declared = normalizeDeclaredType(declaredType);
    if (!declared) {
      return { ok: false, reason: 'El tipo de archivo declarado no está permitido.' };
    }
    if (declared !== type) {
      return { ok: false, reason: 'El tipo declarado no coincide con el contenido del archivo.' };
    }
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `La imagen supera el tamaño máximo de ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const dimensions = readImageDimensions(bytes, type);
  if (!dimensions) {
    return {
      ok: false,
      reason: 'No se pudieron leer las dimensiones de la imagen (archivo truncado o corrupto).',
    };
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return { ok: false, reason: 'Las dimensiones de la imagen no son válidas.' };
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      reason: `Las dimensiones superan el máximo de ${MAX_IMAGE_DIMENSION} px por lado.`,
    };
  }

  return { ok: true, type, width: dimensions.width, height: dimensions.height };
}
