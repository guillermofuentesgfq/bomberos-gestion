/**
 * Constructor mínimo de libros OOXML (`.xlsx`).
 *
 * Un `.xlsx` es una carpeta ZIP con partes XML. Generamos las partes
 * imprescindibles para que Excel, LibreOffice y Google Sheets abran el archivo:
 *
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/worksheets/sheetN.xml
 *
 * Decisiones de diseño:
 *   * **Strings en línea** (`t="inlineStr"`): evitamos mantener una tabla de
 *     cadenas compartidas (`sharedStrings.xml`) y su orden de índices. Es válido
 *     OOXML y el tamaño extra es irrelevante para informes de inventario.
 *   * **Método ZIP store** (sin compresión): ver `lib/zip.ts`.
 *   * **Números como números**: los valores `number` finitos se escriben como
 *     `<v>…</v>`; nunca como texto.
 *   * **Antídotos contra inyección de fórmulas**: un texto que empiece por
 *     `=`, `+`, `-`, `@`, tabulador o retorno de carro se prefija con un
 *     apóstrofo para que la hoja no lo evalúe.
 */

import { AppError } from '../lib/errors';
import { createZip, type ZipEntry } from '../lib/zip';

/** Tipo MIME oficial de una hoja de cálculo OOXML. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Una hoja: nombre visible y filas de celdas. */
export interface SheetSpec {
  name: string;
  rows: (string | number | null)[][];
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Caracteres con significado en XML: texto y valores de atributo entre comillas. */
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Escapa un valor para que sea seguro como texto o atributo XML. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => XML_ESCAPES[char] ?? char);
}

/** Primeros caracteres que Excel interpretaría como fórmula si no se neutralizan. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * Neutraliza textos que una hoja de cálculo podría evaluar como fórmula.
 *
 * Si el valor empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro, se
 * antepone un apóstrofo: el usuario ve el texto original y la hoja no ejecuta
 * nada. Es una defensa contra CSV/Formula Injection (CWE-1236).
 */
export function sanitizeCellText(value: string): string {
  const first = value[0];
  if (first !== undefined && (FORMULA_PREFIXES as readonly string[]).includes(first)) {
    return `'${value}`;
  }
  return value;
}

/** Letra(s) de columna para un índice 0-based (0 → "A", 26 → "AA"). */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Caracteres prohibidos en el nombre de una hoja según Excel. */
const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Recorta el nombre de hoja a 31 caracteres y quita caracteres no válidos. */
export function sanitizeSheetName(name: string): string {
  let clean = name.replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim();
  // Excel no admite nombres que empiecen o terminen con apóstrofo.
  clean = clean.replace(/^'+/, '').replace(/'+$/, '');
  clean = clean.slice(0, 31);
  return clean.length > 0 ? clean : 'Hoja';
}

/** Devuelve el nombre definitivo, resolviendo duplicados dentro del libro. */
function uniqueSheetNames(sheets: SheetSpec[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet) => {
    const base = sanitizeSheetName(sheet.name);
    let candidate = base;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ` (${counter})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** XML de una celda. Devuelve cadena vacía para celdas sin contenido útil. */
function cellXml(reference: string, value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  const text = escapeXml(sanitizeCellText(value));
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

/** XML de la hoja completa. */
function sheetXml(rows: (string | number | null)[][]): string {
  const rowParts: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const cells: string[] = [];
    for (let c = 0; c < row.length; c += 1) {
      const reference = `${columnName(c)}${r + 1}`;
      const cell = cellXml(reference, row[c] ?? null);
      if (cell.length > 0) cells.push(cell);
    }
    rowParts.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  return (
    `${XML_DECLARATION}` +
    `<worksheet xmlns="${MAIN_NS}"><sheetData>${rowParts.join('')}</sheetData></worksheet>`
  );
}

function contentTypesXml(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `${XML_DECLARATION}` +
    `<Types xmlns="${CONTENT_TYPES_NS}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `${overrides}</Types>`
  );
}

function rootRelsXml(): string {
  return (
    `${XML_DECLARATION}` +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    `${XML_DECLARATION}` +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(sheetCount: number): string {
  const rels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" ` +
      `Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return `${XML_DECLARATION}<Relationships xmlns="${PKG_REL_NS}">${rels}</Relationships>`;
}

/**
 * Construye un `.xlsx` válido con las hojas indicadas.
 *
 * La primera fila de cada hoja se suele usar como encabezado, pero eso es
 * responsabilidad de quien llama: aquí las filas se escriben tal cual.
 */
export function buildWorkbook(sheets: SheetSpec[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) {
    throw AppError.badRequest('El libro debe incluir al menos una hoja.');
  }

  const names = uniqueSheetNames(sheets);
  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', content: contentTypesXml(sheets.length) },
    { name: '_rels/.rels', content: rootRelsXml() },
    { name: 'xl/workbook.xml', content: workbookXml(names) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(sheets.length) },
  ];
  sheets.forEach((sheet, index) => {
    files.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheet.rows),
    });
  });

  return createZip(files);
}
