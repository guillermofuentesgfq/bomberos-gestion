import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  detectImageType,
  readImageDimensions,
  validateImageFile,
} from './image';

/** Construye una cabecera PNG mínima (firma + IHDR) con las dimensiones dadas. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // firma
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // longitud IHDR = 13
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  // bytes 24+ (bit depth, color type, CRC…) no se inspeccionan para validar.
  return bytes;
}

/** JPEG mínimo: SOI + un segmento COM + SOF0 con dimensiones + EOI. */
function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xfe, 0x00, 0x04, 0x41, 0x42, // COM (longitud 4)
    0xff, 0xc0, // SOF0
    0x00, 0x11, // longitud del segmento = 17
    0x08, // precisión
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, // nº de componentes
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}

/** Envuelve datos de chunk en un contenedor RIFF/WEBP. */
function riffWebp(fourcc: string, data: number[]): Uint8Array {
  const bytes = new Uint8Array(20 + data.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  const riffSize = 4 + 8 + data.length;
  bytes[4] = riffSize & 0xff;
  bytes[5] = (riffSize >>> 8) & 0xff;
  bytes[6] = (riffSize >>> 16) & 0xff;
  bytes[7] = (riffSize >>> 24) & 0xff;
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set(
    [fourcc.charCodeAt(0), fourcc.charCodeAt(1), fourcc.charCodeAt(2), fourcc.charCodeAt(3)],
    12,
  );
  const chunkSize = data.length;
  bytes[16] = chunkSize & 0xff;
  bytes[17] = (chunkSize >>> 8) & 0xff;
  bytes[18] = (chunkSize >>> 16) & 0xff;
  bytes[19] = (chunkSize >>> 24) & 0xff;
  bytes.set(data, 20);
  return bytes;
}

/** WebP lossy (VP8). */
function webpVp8(width: number, height: number): Uint8Array {
  return riffWebp('VP8 ', [
    0x00, 0x00, 0x00, // cabecera de marco
    0x9d, 0x01, 0x2a, // código de inicio
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
}

/** WebP lossless (VP8L). */
function webpVp8l(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riffWebp('VP8L', [
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ]);
}

/** WebP extendido (VP8X). */
function webpVp8x(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riffWebp('VP8X', [
    0x00, // flags
    0x00, 0x00, 0x00, // reservado
    w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff,
    h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff,
  ]);
}

const encoder = new TextEncoder();

describe('detectImageType', () => {
  it('detecta PNG, JPEG y WebP por bytes mágicos', () => {
    expect(detectImageType(pngBytes(10, 10))).toBe('png');
    expect(detectImageType(jpegBytes(10, 10))).toBe('jpeg');
    expect(detectImageType(webpVp8l(10, 10))).toBe('webp');
  });

  it('devuelve null para contenido que no es imagen', () => {
    expect(detectImageType(encoder.encode('hola mundo'))).toBeNull();
    expect(detectImageType(new Uint8Array(0))).toBeNull();
    expect(detectImageType(encoder.encode('GIF89a'))).toBeNull();
  });
});

describe('readImageDimensions', () => {
  it('lee dimensiones PNG del IHDR', () => {
    expect(readImageDimensions(pngBytes(1234, 5678), 'png')).toEqual({
      width: 1234,
      height: 5678,
    });
  });

  it('lee dimensiones JPEG recorriendo marcadores', () => {
    expect(readImageDimensions(jpegBytes(640, 480), 'jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('lee dimensiones WebP en sus tres variantes', () => {
    expect(readImageDimensions(webpVp8(320, 240), 'webp')).toEqual({ width: 320, height: 240 });
    expect(readImageDimensions(webpVp8l(100, 50), 'webp')).toEqual({ width: 100, height: 50 });
    expect(readImageDimensions(webpVp8x(2000, 1500), 'webp')).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it('devuelve null si el contenido no corresponde al formato', () => {
    expect(readImageDimensions(encoder.encode('no soy jpeg'), 'jpeg')).toBeNull();
    expect(readImageDimensions(new Uint8Array([0x89, 0x50]), 'png')).toBeNull();
  });
});

describe('validateImageFile', () => {
  it('acepta imágenes válidas y devuelve tipo y dimensiones', () => {
    expect(validateImageFile(pngBytes(100, 80))).toEqual({
      ok: true,
      type: 'png',
      width: 100,
      height: 80,
    });
    expect(validateImageFile(jpegBytes(20, 10))).toEqual({
      ok: true,
      type: 'jpeg',
      width: 20,
      height: 10,
    });
    expect(validateImageFile(webpVp8l(64, 64))).toEqual({
      ok: true,
      type: 'webp',
      width: 64,
      height: 64,
    });
  });

  it('acepta cuando el tipo declarado coincide con el contenido', () => {
    const result = validateImageFile(pngBytes(10, 10), 'image/png');
    expect(result.ok).toBe(true);
  });

  it('acepta el sinónimo image/jpg', () => {
    const result = validateImageFile(jpegBytes(10, 10), 'image/jpg');
    expect(result.ok).toBe(true);
  });

  it('rechaza SVG (contenido activo)', () => {
    const svg = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const result = validateImageFile(svg, 'image/svg+xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/SVG/);
  });

  it('rechaza GIF', () => {
    const gif = encoder.encode('GIF89a\x01\x00\x01\x00');
    const result = validateImageFile(gif);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/GIF/);
  });

  it('rechaza texto plano', () => {
    const result = validateImageFile(encoder.encode('esto no es una imagen'));
    expect(result.ok).toBe(false);
  });

  it('rechaza un archivo vacío', () => {
    const result = validateImageFile(new Uint8Array(0));
    expect(result.ok).toBe(false);
  });

  it('rechaza un PNG truncado (dimensiones ilegibles)', () => {
    const truncated = pngBytes(10, 10).subarray(0, 14);
    const result = validateImageFile(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/dimensiones/);
  });

  it('rechaza dimensiones enormes', () => {
    const result = validateImageFile(pngBytes(MAX_IMAGE_DIMENSION + 1, 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/dimensiones/);
  });

  it('rechaza dimensiones no válidas (cero)', () => {
    const result = validateImageFile(pngBytes(0, 0));
    expect(result.ok).toBe(false);
  });

  it('rechaza archivos que superan el tamaño máximo', () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set(pngBytes(10, 10), 0);
    const result = validateImageFile(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tamaño máximo/);
  });

  it('rechaza cuando el tipo declarado no coincide con el contenido', () => {
    const result = validateImageFile(pngBytes(10, 10), 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no coincide/);
  });

  it('rechaza un tipo declarado no permitido', () => {
    const result = validateImageFile(pngBytes(10, 10), 'application/octet-stream');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no está permitido/);
  });
});
