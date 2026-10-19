/**
 * Importación masiva desde hojas de cálculo.
 *
 * El archivo (`.xlsx`, `.xls` o `.csv`) se lee **en el navegador**: el Worker
 * no tiene CPU para descomprimir y parsear OOXML (10 ms en el plan gratuito) ni
 * puede leer BIFF8 sin una librería pesada. El cliente envía las filas ya
 * normalizadas en lotes pequeños y aquí se valida, se guarda en *staging* y, al
 * confirmar, se escribe con SQL **set-based** (`INSERT … SELECT`).
 *
 * Por qué «set-based»: el plan gratuito admite 50 consultas D1 por invocación y
 * cada sentencia de un `batch()` cuenta. Un `INSERT` por fila agotaría el tope
 * con quince materiales; una sentencia que lee el staging escribe miles en una
 * sola operación, dentro de una transacción atómica.
 *
 * Reglas de negocio:
 *   * El `code` del material se normaliza a mayúsculas: así coincide con la
 *     restricción `UNIQUE` y con la detección de duplicados.
 *   * Un código ya existente es un **error**, no una actualización: esta
 *     versión no reescribe materiales. Las existencias se **suman** al saldo
 *     existente para no pisar lo que ya hay.
 *   * Las fotos no forman parte de la importación. Los materiales de una
 *     planilla se crean con `es_individual` según la columna, pero **sin
 *     unidades**: las series y tallas se agregan después desde la ficha.
 */

import { all, batch, first, run, stmt } from '../lib/db';
import { nowIso } from '../lib/time';
import { AppError } from '../lib/errors';
import { logAudit } from '../security/audit';
import type { Actor } from '../security/actor';

export type ImportKind = 'material' | 'person';
export type ImportMode = 'all_or_nothing' | 'valid_only';
export type IssueSeverity = 'error' | 'warning';

/** Tope de filas por petición: acota el número de sentencias por invocación. */
export const MAX_ROWS_PER_CHUNK = 200;
/** Tope de filas por archivo. Más allá, la cuota de escritura de D1 se agota. */
export const MAX_ROWS_PER_FILE = 20_000;

export interface ImportIssue {
  column: string;
  code: string;
  message: string;
  severity: IssueSeverity;
}

// ---------------------------------------------------------------------------
// Normalización de celdas
// ---------------------------------------------------------------------------

/** Texto de una celda: recorta, colapsa espacios y devuelve `''` si no hay. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Clave de comparación: sin acentos, sin mayúsculas y sin espacios sobrantes. */
export function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Entero no negativo, o `null` si la celda no es un número válido. */
function parseCount(value: string): number | null {
  if (value.length === 0) return null;
  const clean = value.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const number = Number(clean);
  return Number.isSafeInteger(number) ? number : null;
}

/** Booleano tolerante: `sí/no`, `si/no`, `x`, `1/0`, `true/false`. */
function parseBool(value: string): boolean | null {
  const key = foldKey(value);
  if (key.length === 0) return null;
  if (['si', 's', 'x', '1', 'true', 'verdadero', 'yes', 'y'].includes(key)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(key)) return false;
  return null;
}

/** Días entre el 1-1-1900 y el 1-1-1970, para convertir el serial de Excel. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

/**
 * Fecha ISO (`aaaa-mm-dd`) a partir de `dd/mm/aaaa`, `aaaa-mm-dd` o el número
 * de serie de Excel. Devuelve `null` si no se puede interpretar.
 */
export function parseDate(value: string): string | null {
  const text = value.trim();
  if (text.length === 0) return null;

  // Serial de Excel (por ejemplo, 44197).
  if (/^\d{4,5}$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) {
      const ms = (serial - EXCEL_EPOCH_OFFSET_DAYS) * 86_400_000;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
  }

  let match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return isoFromParts(year, month, day);
  }

  match = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(text);
  if (match) {
    return isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  return null;
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Normaliza y valida un RUT chileno. Devuelve `{ value }` con el formato
 * canónico (`12345678-9`) o `{ error }` si el dígito verificador no cuadra.
 */
export function normalizeRut(raw: string): { value: string } | { error: string } {
  const clean = raw.replace(/[.\-\s]/g, '').toUpperCase();
  if (clean.length === 0) return { value: '' };
  if (!/^\d{7,9}[0-9K]$/.test(clean)) return { error: 'El RUT no tiene un formato válido.' };

  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  if (expected !== dv) return { error: 'El dígito verificador del RUT no coincide.' };
  return { value: `${body}-${dv}` };
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

interface Catalogs {
  categoryByName: Map<string, number>;
  typeByName: Map<string, number>;
  locationByName: Map<string, number>;
  conditionByName: Map<string, string>;
  qualityByName: Map<string, number>;
  positionTypeByName: Map<string, number>;
}

async function loadCatalogs(db: D1Database): Promise<Catalogs> {
  const [categories, types, locations, conditions, qualities, positions] = await Promise.all([
    all<{ id: number; name: string }>(
      db,
      `SELECT id, name FROM categories WHERE archived_at IS NULL`,
    ),
    all<{ id: number; name: string }>(
      db,
      `SELECT id, name FROM material_types WHERE archived_at IS NULL`,
    ),
    all<{ id: number; name: string }>(
      db,
      `SELECT id, name FROM locations WHERE archived_at IS NULL AND is_archive = 0`,
    ),
    all<{ code: string; name: string }>(db, `SELECT code, name FROM material_conditions`),
    all<{ id: number; name: string }>(db, `SELECT id, name FROM qualities WHERE archived_at IS NULL`),
    all<{ id: number; name: string }>(
      db,
      `SELECT id, name FROM position_types WHERE archived_at IS NULL`,
    ),
  ]);

  const byName = (rows: { id: number; name: string }[]) =>
    new Map(rows.map((row) => [foldKey(row.name), row.id]));

  const conditionByName = new Map<string, string>();
  for (const row of conditions) {
    conditionByName.set(foldKey(row.name), row.code);
    conditionByName.set(foldKey(row.code), row.code);
  }

  return {
    categoryByName: byName(categories),
    typeByName: byName(types),
    locationByName: byName(locations),
    conditionByName,
    qualityByName: byName(qualities),
    positionTypeByName: byName(positions),
  };
}

/** Códigos de material existentes (incluidos los archivados), en mayúsculas. */
async function existingMaterialCodes(db: D1Database, codes: string[]): Promise<Map<string, boolean>> {
  const found = new Map<string, boolean>();
  const unique = [...new Set(codes.map((code) => code.toUpperCase()))];
  for (let i = 0; i < unique.length; i += 90) {
    const slice = unique.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await all<{ code: string; archived_at: string | null }>(
      db,
      `SELECT code, archived_at FROM materials WHERE UPPER(code) IN (${placeholders})`,
      ...slice,
    );
    for (const row of rows) found.set(row.code.toUpperCase(), row.archived_at !== null);
  }
  return found;
}

/** Material ya visto en un lote anterior del mismo archivo. */
interface StagedMaterial {
  name: string | null;
  brand: string | null;
  model: string | null;
}

/** Filas ya analizadas del mismo lote para esos códigos (consistencia entre lotes). */
async function stagedMaterialCodes(
  db: D1Database,
  batchId: number,
  codes: string[],
): Promise<Map<string, StagedMaterial>> {
  const found = new Map<string, StagedMaterial>();
  const unique = [...new Set(codes.map((code) => code.toUpperCase()))];
  for (let i = 0; i < unique.length; i += 90) {
    const slice = unique.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await all<{
      code: string | null;
      name: string | null;
      brand: string | null;
      model: string | null;
    }>(
      db,
      `SELECT code, name, brand, model FROM import_rows_material
        WHERE batch_id = ? AND UPPER(code) IN (${placeholders})`,
      batchId,
      ...slice,
    );
    for (const row of rows) {
      if (row.code) found.set(row.code.toUpperCase(), row);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Entrada de filas
// ---------------------------------------------------------------------------

export interface MaterialRowInput {
  rowNo: number;
  code?: unknown;
  name?: unknown;
  category?: unknown;
  materialType?: unknown;
  brand?: unknown;
  model?: unknown;
  notes?: unknown;
  minStock?: unknown;
  isIndividual?: unknown;
  location?: unknown;
  condition?: unknown;
  quantity?: unknown;
}

export interface PersonRowInput {
  rowNo: number;
  fullName?: unknown;
  rut?: unknown;
  quality?: unknown;
  position?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  birthDate?: unknown;
  joinDate?: unknown;
  registryNo?: unknown;
  emergencyName?: unknown;
  emergencyPhone?: unknown;
  history?: unknown;
  isActive?: unknown;
}

interface StagedRow {
  rowNo: number;
  issues: ImportIssue[];
  columns: (string | number | null)[];
}

function pushIssue(issues: ImportIssue[], column: string, code: string, message: string): void {
  issues.push({ column, code, message, severity: 'error' });
}

function hasErrors(issues: ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

/** Tope de filas por sentencia multi-fila: 100 parámetros por consulta D1. */
function rowsPerStatement(columns: number): number {
  return Math.max(1, Math.floor(100 / columns));
}

async function flushStaging(
  db: D1Database,
  table: 'import_rows_material' | 'import_rows_person',
  columns: string[],
  rows: StagedRow[],
): Promise<void> {
  const perStatement = rowsPerStatement(columns.length);
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const slice = rows.slice(i, i + perStatement);
    const tuple = `(${columns.map(() => '?').join(', ')})`;
    const values = slice.flatMap((row) => row.columns);
    statements.push(
      stmt(
        db,
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${slice.map(() => tuple).join(', ')}`,
        ...values,
      ),
    );
  }
  await batch(db, statements);
}

// ---------------------------------------------------------------------------
// Análisis: materiales
// ---------------------------------------------------------------------------

export interface IngestResult {
  stored: number;
  valid: number;
  errors: number;
  warnings: number;
  total: number;
}

export async function ingestMaterialRows(
  db: D1Database,
  batchId: number,
  rows: MaterialRowInput[],
): Promise<IngestResult> {
  if (rows.length > MAX_ROWS_PER_CHUNK) {
    throw AppError.payloadTooLarge(
      `Cada envío admite hasta ${MAX_ROWS_PER_CHUNK} filas. Divide el archivo en lotes.`,
    );
  }

  const catalogs = await loadCatalogs(db);
  const codes = rows.map((row) => cell(row.code)).filter((code) => code.length > 0);
  const [existing, staged] = await Promise.all([
    existingMaterialCodes(db, codes),
    stagedMaterialCodes(db, batchId, codes),
  ]);

  const seenInChunk = new Map<string, StagedMaterial>();
  const stagedRows: StagedRow[] = [];

  for (const row of rows) {
    const issues: ImportIssue[] = [];
    const rawCode = cell(row.code);
    const code = rawCode.toUpperCase();
    const name = cell(row.name);
    const brand = cell(row.brand);
    const model = cell(row.model);

    if (code.length === 0) pushIssue(issues, 'codigo', 'required', 'El código es obligatorio.');
    else if (code.length > 60) pushIssue(issues, 'codigo', 'too_long', 'El código supera 60 caracteres.');
    if (name.length === 0) pushIssue(issues, 'nombre', 'required', 'El nombre es obligatorio.');
    else if (name.length > 160) pushIssue(issues, 'nombre', 'too_long', 'El nombre supera 160 caracteres.');

    // Catálogos: el nombre debe existir; no se crean entradas implícitas.
    const categoryRaw = cell(row.category);
    const categoryKey = foldKey(categoryRaw);
    let categoryId: number | null = null;
    if (categoryKey.length > 0) {
      const found = catalogs.categoryByName.get(categoryKey);
      if (found === undefined) {
        pushIssue(issues, 'categoria', 'unknown_category', `La categoría «${categoryRaw}» no existe en el catálogo.`);
      } else categoryId = found;
    }

    const typeRaw = cell(row.materialType);
    const typeKey = foldKey(typeRaw);
    let materialTypeId: number | null = null;
    if (typeKey.length > 0) {
      const found = catalogs.typeByName.get(typeKey);
      if (found === undefined) {
        pushIssue(issues, 'tipo', 'unknown_material_type', `El tipo «${typeRaw}» no existe en el catálogo.`);
      } else materialTypeId = found;
    }

    const minStock = parseCount(cell(row.minStock));
    if (cell(row.minStock).length > 0 && minStock === null) {
      pushIssue(issues, 'stock_minimo', 'invalid_number', 'El stock mínimo debe ser un entero no negativo.');
    }

    const individualRaw = cell(row.isIndividual);
    const individual = individualRaw.length > 0 ? parseBool(individualRaw) : false;
    if (individualRaw.length > 0 && individual === null) {
      pushIssue(issues, 'es_individual', 'invalid_boolean', 'Usa sí o no en «es_individual».');
    }

    // Existencias: ubicación y cantidad van juntas; la condición es opcional.
    const locationRaw = cell(row.location);
    const quantity = parseCount(cell(row.quantity));
    const hasLocation = locationRaw.length > 0;
    const hasQuantity = cell(row.quantity).length > 0;
    let locationId: number | null = null;
    let conditionCode: string | null = null;

    if (hasLocation) {
      const found = catalogs.locationByName.get(foldKey(locationRaw));
      if (found === undefined) {
        pushIssue(issues, 'ubicacion', 'unknown_location', `La ubicación «${locationRaw}» no existe en el catálogo.`);
      } else locationId = found;
    }
    if (hasLocation !== hasQuantity) {
      pushIssue(
        issues,
        hasLocation ? 'cantidad' : 'ubicacion',
        'incomplete_stock',
        'Para cargar existencias indica ubicación y cantidad juntas.',
      );
    }
    if (hasQuantity && quantity === null) {
      pushIssue(issues, 'cantidad', 'invalid_number', 'La cantidad debe ser un entero no negativo.');
    }

    const conditionRaw = cell(row.condition);
    if (hasLocation) {
      const key = foldKey(conditionRaw.length > 0 ? conditionRaw : 'operativo');
      const found = catalogs.conditionByName.get(key);
      if (found === undefined) {
        pushIssue(issues, 'condicion', 'unknown_condition', `La condición «${conditionRaw}» no existe.`);
      } else conditionCode = found;
    }

    const notes = cell(row.notes);
    if (notes.length > 1000) pushIssue(issues, 'notas', 'too_long', 'Las notas superan 1000 caracteres.');

    // Duplicados. Un código repetido es válido si describe el mismo material
    // (carga repartida en varias ubicaciones) y error si los datos difieren.
    if (code.length > 0) {
      if (existing.has(code)) {
        const archived = existing.get(code) === true;
        pushIssue(
          issues,
          'codigo',
          'duplicate_existing',
          archived
            ? 'Ya existe un material archivado con ese código. Restáuralo o usa otro código.'
            : 'Ya existe un material con ese código; esta importación no lo actualiza.',
        );
      }
      const prior = seenInChunk.get(code) ?? staged.get(code);
      if (prior) {
        const same =
          (prior.name ?? '') === (name.length > 0 ? name : null) &&
          cell(prior.brand ?? '') === brand &&
          cell(prior.model ?? '') === model;
        if (!same) {
          pushIssue(issues, 'codigo', 'conflicting_fields', 'El mismo código aparece con datos distintos en el archivo.');
        }
      } else if (!existing.has(code)) {
        seenInChunk.set(code, { name: name.length > 0 ? name : null, brand: brand || null, model: model || null });
      }
    }

    if (individual === true) {
      issues.push({
        column: 'es_individual',
        code: 'individual_without_units',
        message: 'El material se crea individual; sus unidades y series se cargan después desde la ficha.',
        severity: 'warning',
      });
    }

    stagedRows.push({
      rowNo: row.rowNo,
      issues,
      columns: [
        batchId,
        row.rowNo,
        hasErrors(issues) ? 'error' : 'valid',
        JSON.stringify(issues),
        code.length > 0 ? code : null,
        name.length > 0 ? name : null,
        categoryId,
        materialTypeId,
        brand.length > 0 ? brand : null,
        model.length > 0 ? model : null,
        notes.length > 0 ? notes : null,
        minStock ?? 0,
        individual === true ? 1 : 0,
        locationId,
        conditionCode,
        quantity ?? 0,
      ],
    });
  }

  if (stagedRows.length > 0) {
    await flushStaging(
      db,
      'import_rows_material',
      [
        'batch_id', 'row_no', 'status', 'issues', 'code', 'name', 'category_id',
        'material_type_id', 'brand', 'model', 'notes', 'min_stock', 'is_individual',
        'location_id', 'condition_code', 'quantity',
      ],
      stagedRows,
    );
  }

  return summarize(db, batchId, 'material', rows.length);
}

// ---------------------------------------------------------------------------
// Análisis: personas
// ---------------------------------------------------------------------------

export async function ingestPersonRows(
  db: D1Database,
  batchId: number,
  rows: PersonRowInput[],
): Promise<IngestResult> {
  if (rows.length > MAX_ROWS_PER_CHUNK) {
    throw AppError.payloadTooLarge(
      `Cada envío admite hasta ${MAX_ROWS_PER_CHUNK} filas. Divide el archivo en lotes.`,
    );
  }

  const catalogs = await loadCatalogs(db);
  const ruts = rows
    .map((row) => {
      const rut = normalizeRut(cell(row.rut));
      return 'value' in rut ? rut.value : '';
    })
    .filter((rut) => rut.length > 0);

  const existingRuts = new Set<string>();
  for (let i = 0; i < ruts.length; i += 90) {
    const slice = ruts.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const found = await all<{ rut: string }>(
      db,
      `SELECT rut FROM persons WHERE rut IN (${placeholders})`,
      ...slice,
    );
    for (const row of found) if (row.rut) existingRuts.add(row.rut);
  }

  const stagedRuts = new Set<string>();
  const stagedNames = new Set<string>();
  for (let i = 0; i < ruts.length; i += 90) {
    const slice = ruts.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const found = await all<{ rut: string | null }>(
      db,
      `SELECT rut FROM import_rows_person WHERE batch_id = ? AND rut IN (${placeholders})`,
      batchId,
      ...slice,
    );
    for (const row of found) if (row.rut) stagedRuts.add(row.rut);
  }
  const names = rows.map((row) => cell(row.fullName)).filter((name) => name.length > 0);
  for (let i = 0; i < names.length; i += 90) {
    const slice = names.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const found = await all<{ full_name: string }>(
      db,
      `SELECT full_name FROM import_rows_person WHERE batch_id = ? AND full_name IN (${placeholders})`,
      batchId,
      ...slice,
    );
    for (const row of found) stagedNames.add(foldKey(row.full_name));
  }

  const seenRuts = new Set<string>();
  const seenNames = new Set<string>();
  const stagedRows: StagedRow[] = [];

  for (const row of rows) {
    const issues: ImportIssue[] = [];
    const fullName = cell(row.fullName);
    if (fullName.length === 0) pushIssue(issues, 'nombre_completo', 'required', 'El nombre es obligatorio.');
    else if (fullName.length > 160) pushIssue(issues, 'nombre_completo', 'too_long', 'El nombre supera 160 caracteres.');

    const rutRaw = cell(row.rut);
    let rut: string | null = null;
    if (rutRaw.length > 0) {
      const normalized = normalizeRut(rutRaw);
      if ('error' in normalized) pushIssue(issues, 'rut', 'invalid_rut', normalized.error);
      else rut = normalized.value;
    }

    const qualityRaw = cell(row.quality);
    let qualityId: number | null = null;
    if (qualityRaw.length > 0) {
      const found = catalogs.qualityByName.get(foldKey(qualityRaw));
      if (found === undefined) {
        pushIssue(issues, 'calidad', 'unknown_quality', `La calidad «${qualityRaw}» no existe en el catálogo.`);
      } else qualityId = found;
    }

    const positionRaw = cell(row.position);
    let positionLabel: string | null = null;
    let positionTypeId: number | null = null;
    if (positionRaw.length > 0) {
      const found = catalogs.positionTypeByName.get(foldKey(positionRaw));
      if (found === undefined) positionLabel = positionRaw;
      else positionTypeId = found;
      if (rut === null) {
        pushIssue(issues, 'cargo', 'position_requires_rut', 'Para importar un cargo, la fila necesita un RUT válido.');
      }
    }

    const email = cell(row.email);
    if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      pushIssue(issues, 'correo', 'invalid_email', 'El correo no tiene un formato válido.');
    }
    if (email.length > 160) pushIssue(issues, 'correo', 'too_long', 'El correo supera 160 caracteres.');

    const birthDateRaw = cell(row.birthDate);
    const birthDate = birthDateRaw.length > 0 ? parseDate(birthDateRaw) : null;
    if (birthDateRaw.length > 0 && birthDate === null) {
      pushIssue(issues, 'fecha_nacimiento', 'invalid_date', 'La fecha de nacimiento no es válida.');
    }
    const joinDateRaw = cell(row.joinDate);
    const joinDate = joinDateRaw.length > 0 ? parseDate(joinDateRaw) : null;
    if (joinDateRaw.length > 0 && joinDate === null) {
      pushIssue(issues, 'fecha_ingreso', 'invalid_date', 'La fecha de ingreso no es válida.');
    }

    const isActiveRaw = cell(row.isActive);
    const isActive = isActiveRaw.length > 0 ? parseBool(isActiveRaw) : true;
    if (isActiveRaw.length > 0 && isActive === null) {
      pushIssue(issues, 'activo', 'invalid_boolean', 'Usa sí o no en «activo».');
    }

    const history = cell(row.history);
    if (history.length > 4000) pushIssue(issues, 'notas', 'too_long', 'Las notas superan 4000 caracteres.');

    // Duplicados: el RUT manda; sin RUT, dos nombres iguales se avisan.
    if (rut !== null) {
      if (existingRuts.has(rut)) {
        pushIssue(issues, 'rut', 'duplicate_existing', 'Ya existe una ficha con ese RUT.');
      }
      if (stagedRuts.has(rut) || seenRuts.has(rut)) {
        pushIssue(issues, 'rut', 'duplicate_in_file', 'El RUT aparece más de una vez en el archivo.');
      }
      seenRuts.add(rut);
    } else if (fullName.length > 0) {
      const key = foldKey(fullName);
      if (stagedNames.has(key) || seenNames.has(key)) {
        issues.push({
          column: 'nombre_completo',
          code: 'duplicate_name_in_file',
          message: 'Hay más de una persona con el mismo nombre y sin RUT. Revisa si es un duplicado.',
          severity: 'warning',
        });
      }
      seenNames.add(key);
    }

    stagedRows.push({
      rowNo: row.rowNo,
      issues,
      columns: [
        batchId,
        row.rowNo,
        hasErrors(issues) ? 'error' : 'valid',
        JSON.stringify(issues),
        fullName.length > 0 ? fullName : null,
        rut,
        null, // person_id: se rellena al confirmar
        qualityId,
        positionTypeId,
        positionLabel,
        cell(row.phone) || null,
        email || null,
        cell(row.address) || null,
        birthDate,
        joinDate,
        cell(row.registryNo) || null,
        cell(row.emergencyName) || null,
        cell(row.emergencyPhone) || null,
        history || null,
      ],
    });
  }

  if (stagedRows.length > 0) {
    await flushStaging(
      db,
      'import_rows_person',
      [
        'batch_id', 'row_no', 'status', 'issues', 'full_name', 'rut', 'person_id',
        'quality_id', 'position_type_id', 'position_label', 'phone', 'email', 'address',
        'birth_date', 'join_date', 'registry_no', 'emergency_name', 'emergency_phone', 'history',
      ],
      stagedRows,
    );
  }

  return summarize(db, batchId, 'person', rows.length);
}

// ---------------------------------------------------------------------------
// Resumen y consulta
// ---------------------------------------------------------------------------

async function summarize(
  db: D1Database,
  batchId: number,
  kind: ImportKind,
  added: number,
): Promise<IngestResult> {
  const table = kind === 'material' ? 'import_rows_material' : 'import_rows_person';
  const source = await first<{ total: number; valid: number; errors: number; warnings: number }>(
    db,
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END), 0) AS valid,
            COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
            COALESCE(SUM(CASE WHEN status = 'valid' AND issues LIKE '%"severity":"warning"%' THEN 1 ELSE 0 END), 0) AS warnings
       FROM ${table} WHERE batch_id = ?`,
    batchId,
  );

  const total = source?.total ?? 0;
  const valid = source?.valid ?? 0;
  const errors = source?.errors ?? 0;
  const warnings = source?.warnings ?? 0;

  await run(
    db,
    `UPDATE import_batches
        SET total_rows = ?, valid_rows = ?, error_rows = ?, warning_rows = ?
      WHERE id = ?`,
    total,
    valid,
    errors,
    warnings,
    batchId,
  );

  return { stored: added, valid, errors, warnings, total };
}

export interface ImportBatchRow {
  id: number;
  kind: ImportKind;
  filename: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  warning_rows: number;
  mode: string | null;
  result: string | null;
  created_by: number | null;
  created_at: string;
  finished_at: string | null;
}

const BATCH_COLUMNS = `id, kind, filename, status, total_rows, valid_rows, error_rows,
  warning_rows, mode, result, created_by, created_at, finished_at`;

export async function createBatch(
  db: D1Database,
  kind: ImportKind,
  filename: string | null,
  userId: number | null,
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO import_batches (kind, filename, status, created_at, created_by)
     VALUES (?, ?, 'analyzing', ?, ?)`,
    kind,
    filename,
    nowIso(),
    userId,
  );
  return Number(result.meta.last_row_id);
}

export async function findBatch(db: D1Database, id: number): Promise<ImportBatchRow | null> {
  return first<ImportBatchRow>(db, `SELECT ${BATCH_COLUMNS} FROM import_batches WHERE id = ?`, id);
}

export async function listBatches(db: D1Database, limit = 20): Promise<ImportBatchRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  return all<ImportBatchRow>(
    db,
    `SELECT ${BATCH_COLUMNS} FROM import_batches ORDER BY id DESC LIMIT ?`,
    capped,
  );
}

export interface IssueBucket {
  code: string;
  severity: IssueSeverity;
  column: string;
  message: string;
  count: number;
}

/** Errores agrupados por código, con un ejemplo de mensaje. */
export async function issueBuckets(db: D1Database, batchId: number): Promise<IssueBucket[]> {
  const rows = await all<{ issues: string | null }>(
    db,
    `SELECT issues FROM import_rows_material WHERE batch_id = ? AND issues IS NOT NULL AND issues <> '[]'
     UNION ALL
     SELECT issues FROM import_rows_person WHERE batch_id = ? AND issues IS NOT NULL AND issues <> '[]'`,
    batchId,
    batchId,
  );
  const buckets = new Map<string, IssueBucket>();
  for (const row of rows) {
    let issues: ImportIssue[] = [];
    try {
      issues = JSON.parse(row.issues ?? '[]') as ImportIssue[];
    } catch {
      issues = [];
    }
    for (const issue of issues) {
      const key = `${issue.severity}:${issue.code}:${issue.column}`;
      const found = buckets.get(key);
      if (found) found.count += 1;
      else buckets.set(key, { ...issue, count: 1 });
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------

export interface FinalizeResult {
  imported: number;
  skipped: number;
  stockRows: number;
}

/**
 * Confirma el lote.
 *
 * `all_or_nothing` exige que el análisis no haya dejado ningún error; si lo
 * hay, no escribe nada. `valid_only` importa las filas válidas y omite el
 * resto, dejando las filas con error marcadas como tales para el informe.
 */
export async function finalizeBatch(
  db: D1Database,
  batchId: number,
  mode: ImportMode,
  actor: Actor,
): Promise<FinalizeResult> {
  const batchRow = await findBatch(db, batchId);
  if (!batchRow) throw AppError.notFound('Lote de importación no encontrado.');
  if (batchRow.status === 'committed') {
    throw AppError.conflict('Este lote ya se importó.');
  }
  if (batchRow.status === 'committing') {
    throw AppError.conflict('Este lote se está confirmando.');
  }
  if (batchRow.total_rows === 0) {
    throw AppError.unprocessable('El lote no tiene filas analizadas.');
  }
  if (mode === 'all_or_nothing' && batchRow.error_rows > 0) {
    throw AppError.unprocessable(
      `El archivo tiene ${batchRow.error_rows} fila(s) con errores. Corrige el informe o usa el modo «solo filas válidas».`,
    );
  }

  await run(db, `UPDATE import_batches SET status = 'committing' WHERE id = ?`, batchId);

  try {
    const result =
      batchRow.kind === 'material'
        ? await commitMaterials(db, batchId)
        : await commitPersons(db, batchId);

    await run(
      db,
      `UPDATE import_batches SET status = 'committed', mode = ?, result = ?, finished_at = ?
        WHERE id = ?`,
      mode,
      JSON.stringify(result),
      nowIso(),
      batchId,
    );

    await logAudit(db, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: batchRow.kind === 'material' ? 'inventory.imported' : 'persons.imported',
      entityType: 'import_batch',
      entityId: batchId,
      detail: { kind: batchRow.kind, mode, ...result },
      ipHash: actor.ipHash,
    });

    return result;
  } catch (error) {
    await run(db, `UPDATE import_batches SET status = 'failed' WHERE id = ?`, batchId);
    throw error;
  }
}

async function commitMaterials(db: D1Database, batchId: number): Promise<FinalizeResult> {
  const now = nowIso();

  const inserted = await run(
    db,
    `INSERT INTO materials
       (code, name, category_id, material_type_id, brand, model, notes, min_stock,
        is_individual, created_at, updated_at)
     SELECT code, MAX(name), MAX(category_id), MAX(material_type_id), MAX(brand), MAX(model),
            MAX(notes), MAX(min_stock), MAX(is_individual), ?, ?
       FROM import_rows_material
      WHERE batch_id = ? AND status = 'valid'
      GROUP BY code
     ON CONFLICT(code) DO NOTHING`,
    now,
    now,
    batchId,
  );
  const imported = inserted.meta.changes ?? 0;

  const stock = await run(
    db,
    `INSERT INTO stock_levels (material_id, location_id, condition_code, quantity, updated_at)
     SELECT m.id, r.location_id, r.condition_code, SUM(r.quantity), ?
       FROM import_rows_material r
       JOIN materials m ON m.code = r.code
      WHERE r.batch_id = ? AND r.status = 'valid'
        AND r.location_id IS NOT NULL AND r.condition_code IS NOT NULL AND r.quantity > 0
      GROUP BY m.id, r.location_id, r.condition_code
     ON CONFLICT(material_id, location_id, condition_code)
     DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
    now,
    batchId,
  );

  await run(
    db,
    `INSERT INTO movements
       (created_at, movement_type, material_id, code, item_name, quantity, to_location_id, notes, actor_user_id)
     SELECT ?, 'ingreso', m.id, m.code, m.name, SUM(r.quantity), r.location_id, ?, NULL
       FROM import_rows_material r
       JOIN materials m ON m.code = r.code
      WHERE r.batch_id = ? AND r.status = 'valid'
        AND r.location_id IS NOT NULL AND r.quantity > 0
      GROUP BY m.id, r.location_id`,
    now,
    'Importación masiva',
    batchId,
  );

  await run(
    db,
    `UPDATE import_rows_material SET status = 'committed' WHERE batch_id = ? AND status = 'valid'`,
    batchId,
  );

  const skipped = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM import_rows_material WHERE batch_id = ? AND status = 'error'`,
    batchId,
  );

  return { imported, skipped: skipped?.n ?? 0, stockRows: stock.meta.changes ?? 0 };
}

async function commitPersons(db: D1Database, batchId: number): Promise<FinalizeResult> {
  const now = nowIso();

  const inserted = await run(
    db,
    `INSERT INTO persons
       (full_name, rut, quality_id, phone, email, address, birth_date, join_date, registry_no,
        emergency_name, emergency_phone, history, is_active, created_at, updated_at)
     SELECT full_name, rut, quality_id, phone, email, address, birth_date, join_date, registry_no,
            emergency_name, emergency_phone, history, 1, ?, ?
       FROM import_rows_person
      WHERE batch_id = ? AND status = 'valid'`,
    now,
    now,
    batchId,
  );
  const imported = inserted.meta.changes ?? 0;

  // Se ata cada fila a la ficha recién creada por RUT. Los RUT duplicados se
  // detectan en el análisis, así que esta subconsulta resuelve una sola fila.
  await run(
    db,
    `UPDATE import_rows_person
        SET person_id = (
          SELECT p.id FROM persons p
           WHERE p.rut = import_rows_person.rut
           ORDER BY p.id LIMIT 1
        )
      WHERE batch_id = ? AND status = 'valid' AND rut IS NOT NULL`,
    batchId,
  );

  await run(
    db,
    `INSERT INTO person_positions (person_id, position_type_id, position_label, start_date, created_at)
     SELECT r.person_id, r.position_type_id, r.position_label, r.join_date, ?
       FROM import_rows_person r
      WHERE r.batch_id = ? AND r.status = 'valid' AND r.person_id IS NOT NULL
        AND (r.position_label IS NOT NULL OR r.position_type_id IS NOT NULL)`,
    now,
    batchId,
  );

  await run(
    db,
    `UPDATE import_rows_person SET status = 'committed' WHERE batch_id = ? AND status = 'valid'`,
    batchId,
  );

  const skipped = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM import_rows_person WHERE batch_id = ? AND status = 'error'`,
    batchId,
  );

  return { imported, skipped: skipped?.n ?? 0, stockRows: 0 };
}

// ---------------------------------------------------------------------------
// Informe de errores
// ---------------------------------------------------------------------------

export interface IssueReportRow {
  rowNo: number;
  column: string;
  severity: string;
  code: string;
  message: string;
  value: string;
}

/** Filas con problemas, para el informe descargable. */
export async function issueReport(
  db: D1Database,
  batchId: number,
  limit = 2000,
): Promise<IssueReportRow[]> {
  const rows = await all<{ row_no: number; issues: string | null; name: string | null; full_name: string | null; code: string | null; rut: string | null }>(
    db,
    `SELECT row_no, issues, name, NULL AS full_name, code, NULL AS rut FROM import_rows_material
      WHERE batch_id = ? AND issues IS NOT NULL AND issues <> '[]'
     UNION ALL
     SELECT row_no, issues, NULL AS name, full_name, NULL AS code, rut FROM import_rows_person
      WHERE batch_id = ? AND issues IS NOT NULL AND issues <> '[]'
     ORDER BY row_no LIMIT ?`,
    batchId,
    batchId,
    Math.min(Math.max(limit, 1), 20_000),
  );

  const out: IssueReportRow[] = [];
  for (const row of rows) {
    let issues: ImportIssue[] = [];
    try {
      issues = JSON.parse(row.issues ?? '[]') as ImportIssue[];
    } catch {
      issues = [];
    }
    const subject = row.code ?? row.rut ?? row.name ?? row.full_name ?? '';
    for (const issue of issues) {
      out.push({
        rowNo: row.row_no,
        column: issue.column,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        value: subject,
      });
    }
  }
  return out;
}
