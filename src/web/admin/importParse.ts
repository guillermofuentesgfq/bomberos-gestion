/**
 * Lectura de planillas en el navegador.
 *
 * SheetJS se carga **bajo demanda** (`await import('xlsx')`), de modo que los
 * cientos de kilobytes de la librería no entran en el paquete inicial: solo se
 * descargan al abrir la pantalla de importación y usar un archivo.
 *
 * Aquí no se valida nada de negocio: el servidor vuelve a validar cada fila.
 * Este módulo solo convierte el archivo en filas con las claves esperadas por
 * la API, para que la pantalla pueda contarlas y enviarlas por lotes.
 */

/** Claves de la API por tipo de importación. */
export type RowKeyMap = Record<string, string>;

export interface ParsedRow {
  rowNo: number;
  values: Record<string, unknown>;
}

export interface ParseResult {
  headers: string[];
  rows: ParsedRow[];
  /** Encabezados esperados que no aparecieron en el archivo. */
  missing: string[];
}

/** Clave de comparación de encabezados: sin acentos, sin mayúsculas. */
function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Decodifica un CSV: UTF-8 y, si falla, Windows-1252 (Excel es-CL). */
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Lee el archivo y devuelve las filas con las claves de la API.
 *
 * `keys` relaciona el encabezado (en la forma que aparece en la plantilla) con
 * la clave que espera la API; la comparación ignora acentos y mayúsculas.
 */
export async function parseSpreadsheet(file: File, keys: RowKeyMap): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name);

  const workbook = isCsv
    ? XLSX.read(decodeCsv(buffer), { type: 'string' })
    : XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], missing: Object.keys(keys) };
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { headers: [], rows: [], missing: Object.keys(keys) };
  }

  // `raw: false` convierte todo a texto y `dateNF` fija las fechas en ISO, que
  // es lo que el servidor interpreta sin ambigüedad.
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  // El encabezado es la primera fila con contenido.
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => String(cell).trim().length > 0),
  );
  if (headerIndex === -1) {
    return { headers: [], rows: [], missing: Object.keys(keys) };
  }

  const headerRow = (matrix[headerIndex] ?? []).map((cell) => String(cell).trim());
  const labelByKey = new Map<string, string>(); // encabezado plegado → clave API
  for (const [header, key] of Object.entries(keys)) {
    labelByKey.set(foldKey(header), key);
  }

  const columnKeys = headerRow.map((header) => labelByKey.get(foldKey(header)) ?? null);
  const presentLabels = new Set(columnKeys.filter((key): key is string => key !== null));
  const missing = Object.values(keys).filter((key) => !presentLabels.has(key));

  const rows: ParsedRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const values: Record<string, unknown> = {};
    let hasContent = false;
    for (let col = 0; col < columnKeys.length; col += 1) {
      const key = columnKeys[col];
      if (key === null || key === undefined) continue;
      const raw = row[col];
      const text = raw === undefined || raw === null ? '' : String(raw).trim();
      if (text.length > 0) hasContent = true;
      values[key] = text;
    }
    if (!hasContent) continue;
    // El número de fila visible en la hoja (1-based, contando el encabezado).
    rows.push({ rowNo: i + 1, values });
  }

  return { headers: headerRow, rows, missing };
}
