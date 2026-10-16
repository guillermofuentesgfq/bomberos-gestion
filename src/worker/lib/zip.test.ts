import { describe, expect, it } from 'vitest';
import { createZip, crc32 } from './zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

interface ReadEntry {
  name: string;
  content: Uint8Array;
  crc: number;
  localOffset: number;
}

/**
 * Lector mínimo de ZIP escrito para la prueba: localiza el EOCD al final,
 * recorre el directorio central y extrae los datos de cada cabecera local.
 */
function readZip(zip: Uint8Array): ReadEntry[] {
  const eocdOffset = zip.length - 22;
  expect(readUint32(zip, eocdOffset)).toBe(0x06054b50);
  const total = readUint16(zip, eocdOffset + 10);
  const centralOffset = readUint32(zip, eocdOffset + 16);

  const entries: ReadEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < total; i += 1) {
    expect(readUint32(zip, cursor)).toBe(0x02014b50);
    const crc = readUint32(zip, cursor + 16);
    const size = readUint32(zip, cursor + 20);
    const nameLength = readUint16(zip, cursor + 28);
    const extraLength = readUint16(zip, cursor + 30);
    const commentLength = readUint16(zip, cursor + 32);
    const localOffset = readUint32(zip, cursor + 42);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));

    expect(readUint32(zip, localOffset)).toBe(0x04034b50);
    const localNameLength = readUint16(zip, localOffset + 26);
    const localExtraLength = readUint16(zip, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const content = zip.slice(dataStart, dataStart + size);

    entries.push({ name, content, crc, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('createZip', () => {
  it('empieza con la firma de cabecera local PK\\x03\\x04', () => {
    const zip = createZip([{ name: 'a.txt', content: 'hola' }]);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('incluye la firma del directorio central PK\\x01\\x02', () => {
    const zip = createZip([{ name: 'a.txt', content: 'hola' }]);
    const eocdOffset = zip.length - 22;
    const centralOffset = readUint32(zip, eocdOffset + 16);
    expect(Array.from(zip.subarray(centralOffset, centralOffset + 4))).toEqual([
      0x50, 0x4b, 0x01, 0x02,
    ]);
  });

  it('es coherente entre offsets, tamaño del directorio y longitud total', () => {
    const zip = createZip([
      { name: 'a.txt', content: 'uno' },
      { name: 'b.txt', content: 'dos' },
    ]);
    const eocdOffset = zip.length - 22;
    const centralOffset = readUint32(zip, eocdOffset + 16);
    const centralSize = readUint32(zip, eocdOffset + 12);
    // Directorio central + EOCD (22 bytes) == longitud total del archivo.
    expect(centralOffset + centralSize + 22).toBe(zip.length);

    const entries = readZip(zip);
    for (const entry of entries) {
      expect(entry.localOffset).toBeLessThan(centralOffset);
    }
  });

  it('calcula CRC-32 conocidos', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('puede releerse y extraer sus entradas con un lector mínimo', () => {
    const zip = createZip([
      { name: 'hola.txt', content: 'Hola mundo' },
      { name: 'datos.bin', content: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'acentos.txt', content: 'ñandú' },
    ]);

    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['hola.txt', 'datos.bin', 'acentos.txt']);
    expect(decoder.decode(entries[0]?.content)).toBe('Hola mundo');
    expect(Array.from(entries[1]?.content ?? [])).toEqual([1, 2, 3, 4, 5]);
    expect(decoder.decode(entries[2]?.content)).toBe('ñandú');
    expect(entries[0]?.crc).toBe(crc32(encoder.encode('Hola mundo')));
  });
});
