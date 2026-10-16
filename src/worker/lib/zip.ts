/**
 * Escritor de archivos ZIP sin dependencias externas.
 *
 * Un `.xlsx` no es más que un ZIP con partes XML. Como el tamaño del XML es
 * pequeño frente al coste de implementar DEFLATE, se usa el método *store*
 * (sin compresión, método 0): los lectores de hojas de cálculo lo aceptan sin
 * problema y no hace falta inflar/deflar nada.
 *
 * Solo se usan APIs disponibles en el runtime de Cloudflare Workers
 * (`Uint8Array`, `TextEncoder`, `DataView`); no se importa nada de Node.
 */

/** Entrada del ZIP. El contenido puede ser texto (se codifica en UTF-8) o bytes. */
export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

// --- Firmas del formato -----------------------------------------------------

const LOCAL_FILE_HEADER = 0x04034b50; // "PK\x03\x04"
const CENTRAL_DIR_HEADER = 0x02014b50; // "PK\x01\x02"
const END_OF_CENTRAL_DIR = 0x06054b50; // "PK\x05\x06"

/** Versión mínima para "store": 1.0; usamos 2.0 (20) por compatibilidad. */
const VERSION = 20;

/**
 * Marca de fecha/hora MS-DOS. Fijamos 2020-01-01 00:00:00 para que el ZIP
 * sea reproducible (mismo contenido, mismos bytes) y no dependa del reloj.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/** Bandera general: nombres codificados en UTF-8 (bit 11). */
const FLAG_UTF8 = 0x0800;

// --- CRC-32 -----------------------------------------------------------------

/** Tabla de CRC-32 (polinomio 0xEDB88320) precalculada una sola vez. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (sin signo) de un bloque de bytes. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    crc = ((crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Escritura secuencial little-endian -------------------------------------

/** Buffer de bytes que crece a demanda y escribe enteros little-endian. */
class ByteWriter {
  private buffer: Uint8Array<ArrayBuffer>;
  private view: DataView<ArrayBuffer>;
  private length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  /** Bytes escritos hasta ahora (también sirve como offset del próximo). */
  get offset(): number {
    return this.length;
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length === 0 ? 1024 : this.buffer.length * 2;
    while (capacity < needed) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  writeUint16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, value & 0xffff, true);
    this.length += 2;
  }

  writeUint32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, value >>> 0, true);
    this.length += 4;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  /** Copia exacta de los bytes escritos (recorta la capacidad sobrante). */
  toUint8Array(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.length);
  }
}

// --- API pública ------------------------------------------------------------

/**
 * Construye un ZIP (método *store*) a partir de una lista de archivos.
 *
 * Se escriben, en orden: una cabecera local + datos por archivo, el directorio
 * central y el registro de fin de directorio (EOCD). Los offsets del directorio
 * central se calculan sobre la posición real de cada cabecera local.
 */
export function createZip(files: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const out = new ByteWriter();
  const central: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data =
      typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const localOffset = out.offset;

    // Cabecera local.
    out.writeUint32(LOCAL_FILE_HEADER);
    out.writeUint16(VERSION);
    out.writeUint16(FLAG_UTF8);
    out.writeUint16(0); // método: store
    out.writeUint16(DOS_TIME);
    out.writeUint16(DOS_DATE);
    out.writeUint32(crc);
    out.writeUint32(data.length); // tamaño comprimido == sin comprimir
    out.writeUint32(data.length);
    out.writeUint16(nameBytes.length);
    out.writeUint16(0); // longitud de campo extra
    out.writeBytes(nameBytes);
    out.writeBytes(data);

    central.push({ nameBytes, crc, size: data.length, offset: localOffset });
  }

  const centralOffset = out.offset;
  for (const entry of central) {
    out.writeUint32(CENTRAL_DIR_HEADER);
    out.writeUint16(VERSION); // versión con la que se creó
    out.writeUint16(VERSION); // versión mínima necesaria
    out.writeUint16(FLAG_UTF8);
    out.writeUint16(0); // método: store
    out.writeUint16(DOS_TIME);
    out.writeUint16(DOS_DATE);
    out.writeUint32(entry.crc);
    out.writeUint32(entry.size);
    out.writeUint32(entry.size);
    out.writeUint16(entry.nameBytes.length);
    out.writeUint16(0); // campo extra
    out.writeUint16(0); // comentario
    out.writeUint16(0); // disco de inicio
    out.writeUint16(0); // atributos internos
    out.writeUint32(0); // atributos externos
    out.writeUint32(entry.offset); // offset de la cabecera local
    out.writeBytes(entry.nameBytes);
  }
  const centralSize = out.offset - centralOffset;

  // Registro de fin de directorio central (EOCD).
  out.writeUint32(END_OF_CENTRAL_DIR);
  out.writeUint16(0); // número de disco
  out.writeUint16(0); // disco del directorio central
  out.writeUint16(central.length); // entradas en este disco
  out.writeUint16(central.length); // entradas totales
  out.writeUint32(centralSize);
  out.writeUint32(centralOffset);
  out.writeUint16(0); // longitud del comentario

  return out.toUint8Array();
}
