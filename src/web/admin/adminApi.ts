/**
 * Cliente HTTP tipado del panel administrativo.
 *
 * Reutiliza la misma convención que `src/web/lib/api.ts`:
 *   - sobre de éxito `{ ok: true, data: T }`
 *   - sobre de error `{ ok: false, error: { code, message, issues? } }`
 *   - cookie de sesión `HttpOnly` enviada con `credentials: 'include'`
 *   - cabecera `X-CSRF-Token` en toda operación con estado
 *
 * Los errores se normalizan a `ApiError` (de `lib/api`) para que las pantallas
 * puedan leer `code`, `message` e `issues` de forma uniforme.
 */

import { ApiError } from '../lib/api';
import type { FieldIssue } from '../lib/api';

const CSRF_HEADER = 'x-csrf-token';
const BASE = '/api/v1';

interface RequestOptions {
  method?: string | undefined;
  body?: unknown;
  csrfToken?: string | undefined;
  signal?: AbortSignal | undefined;
}

interface OkEnvelope<T> {
  ok: true;
  data: T;
}

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    issues?: FieldIssue[];
  };
}

function isOkEnvelope(value: unknown): value is OkEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok: unknown }).ok === true &&
    'data' in value
  );
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { ok?: unknown; error?: unknown };
  if (candidate.ok !== false || typeof candidate.error !== 'object' || candidate.error === null) {
    return false;
  }
  const error = candidate.error as { code?: unknown; message?: unknown };
  return typeof error.code === 'string' && typeof error.message === 'string';
}

/** Ejecuta una petición y resuelve `data`, o lanza `ApiError`. */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
  };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.csrfToken) {
    headers[CSRF_HEADER] = options.csrfToken;
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'network_error',
      0,
      'No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.',
    );
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (isErrorEnvelope(payload)) {
    throw new ApiError(
      payload.error.code,
      response.status,
      payload.error.message,
      payload.error.issues ?? [],
    );
  }

  if (!response.ok) {
    throw new ApiError(
      'http_error',
      response.status,
      'Ocurrió un error inesperado al comunicarse con el servidor.',
    );
  }

  if (!isOkEnvelope(payload)) {
    throw new ApiError('invalid_response', response.status, 'El servidor devolvió una respuesta inesperada.');
  }

  return payload.data as T;
}

/** Mensaje legible para cualquier error, en español de Chile. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network_error') {
      return 'No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.';
    }
    return error.message || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---------------------------------------------------------------------------
// Catálogo de inventario
// ---------------------------------------------------------------------------

export interface LocationOption {
  id: number;
  name: string;
  is_archive: number;
  archived_at: string | null;
}

export interface CategoryOption {
  id: number;
  name: string;
}

export interface MaterialTypeOption {
  id: number;
  name: string;
  category_id: number | null;
}

export interface ConditionOption {
  code: string;
  name: string;
  is_available: number;
}

export interface InventoryCatalog {
  locations: LocationOption[];
  categories: CategoryOption[];
  materialTypes: MaterialTypeOption[];
  conditions: ConditionOption[];
}

/** `GET /inventory/catalog`. */
export function fetchInventoryCatalog(signal?: AbortSignal): Promise<InventoryCatalog> {
  return request<InventoryCatalog>(`${BASE}/inventory/catalog`, { signal });
}

export interface CreateMaterialTypeInput {
  name: string;
  categoryId?: number | null | undefined;
}

/** `POST /inventory/catalog/material-types`. */
export function createMaterialType(
  input: CreateMaterialTypeInput,
  csrfToken: string,
): Promise<{ id: number }> {
  return request<{ id: number }>(`${BASE}/inventory/catalog/material-types`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

/** `DELETE /inventory/catalog/locations/:id`. */
export function archiveLocation(id: number, csrfToken: string): Promise<{ archived: true }> {
  return request<{ archived: true }>(`${BASE}/inventory/catalog/locations/${id}`, {
    method: 'DELETE',
    csrfToken,
  });
}

/** `DELETE /inventory/catalog/categories/:id`. */
export function archiveCategory(id: number, csrfToken: string): Promise<{ archived: true }> {
  return request<{ archived: true }>(`${BASE}/inventory/catalog/categories/${id}`, {
    method: 'DELETE',
    csrfToken,
  });
}

/** `DELETE /inventory/catalog/material-types/:id`. */
export function archiveMaterialType(id: number, csrfToken: string): Promise<{ archived: true }> {
  return request<{ archived: true }>(`${BASE}/inventory/catalog/material-types/${id}`, {
    method: 'DELETE',
    csrfToken,
  });
}

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------

export interface MaterialSummary {
  id: number;
  code: string;
  name: string;
  brand: string | null;
  model: string | null;
  minStock: number;
  isIndividual: boolean;
  total: number;
  available: number;
  belowMinStock: boolean;
  /** Objeto de almacenamiento de la foto (privada), o null si no tiene. */
  photoObjectId: number | null;
}

export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  material_type_id: number | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  min_stock: number;
  is_individual: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  photo_object_id: number | null;
}

export interface StockLevel {
  id: number;
  location_id: number;
  location_name: string;
  condition_code: string;
  quantity: number;
}

export interface MaterialUnit {
  id: number;
  material_id: number;
  code: string;
  serial: string | null;
  size: string | null;
  lot_id: number | null;
  created_at: string;
  archived_at: string | null;
}

export interface Movement {
  id: number;
  created_at: string;
  movement_type: string;
  material_id: number | null;
  unit_id: number | null;
  code: string | null;
  item_name: string | null;
  quantity: number;
  from_location_id: number | null;
  to_location_id: number | null;
  person_id: number | null;
  responsible: string | null;
  notes: string | null;
  actor_user_id: number | null;
}

export interface MaterialDetail {
  material: MaterialRow;
  stock: StockLevel[];
  units: MaterialUnit[];
  movements: Movement[];
}

export interface MaterialFilters {
  q?: string | undefined;
  categoryId?: number | undefined;
  locationId?: number | undefined;
}

/** `GET /inventory/materials`. */
export function fetchMaterials(
  filters: MaterialFilters = {},
  signal?: AbortSignal,
): Promise<MaterialSummary[]> {
  const path = `${BASE}/inventory/materials${query({
    q: filters.q,
    categoryId: filters.categoryId,
    locationId: filters.locationId,
  })}`;
  return request<MaterialSummary[]>(path, { signal });
}

export interface CreateMaterialInput {
  name: string;
  code?: string | undefined;
  categoryId?: number | null | undefined;
  materialTypeId?: number | null | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
  minStock?: number | undefined;
  isIndividual?: boolean | undefined;
  photoObjectId?: number | null | undefined;
  locationId?: number | null | undefined;
  conditionCode?: string | undefined;
  quantity?: number | undefined;
}

/** `POST /inventory/materials`. */
export function createMaterial(
  csrfToken: string,
  input: CreateMaterialInput,
): Promise<{ id: number; code: string }> {
  return request<{ id: number; code: string }>(`${BASE}/inventory/materials`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

/** `GET /inventory/materials/:id`. */
export function fetchMaterialDetail(id: number, signal?: AbortSignal): Promise<MaterialDetail> {
  return request<MaterialDetail>(`${BASE}/inventory/materials/${id}`, { signal });
}

export interface UpdateMaterialInput {
  name?: string | undefined;
  code?: string | null | undefined;
  categoryId?: number | null | undefined;
  materialTypeId?: number | null | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
  minStock?: number | undefined;
  isIndividual?: boolean | undefined;
  photoObjectId?: number | null | undefined;
}

/**
 * `PUT /inventory/materials/:id`.
 *
 * Los campos omitidos conservan su valor; los `null` limpian los que admiten
 * nulos. La respuesta usa el mismo DTO que el listado (`MaterialSummary`).
 */
export function updateMaterial(
  id: number,
  input: UpdateMaterialInput,
  csrfToken: string,
): Promise<{ material: MaterialSummary }> {
  return request<{ material: MaterialSummary }>(`${BASE}/inventory/materials/${id}`, {
    method: 'PUT',
    csrfToken,
    body: input,
  });
}

export interface AddStockInput {
  locationId: number;
  conditionCode: string;
  quantity: number;
  notes?: string | undefined;
}

/** `POST /inventory/materials/:id/stock`. */
export function addMaterialStock(
  csrfToken: string,
  id: number,
  input: AddStockInput,
): Promise<{ added: true }> {
  return request<{ added: true }>(`${BASE}/inventory/materials/${id}/stock`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

/** `GET /inventory/movements`. */
export function fetchMovements(limit = 200, signal?: AbortSignal): Promise<Movement[]> {
  return request<Movement[]>(`${BASE}/inventory/movements${query({ limit })}`, { signal });
}

// ---------------------------------------------------------------------------
// Traslados y bajas
// ---------------------------------------------------------------------------

export interface TransferInput {
  materialId: number;
  fromLocationId: number;
  toLocationId: number;
  conditionCode: string;
  quantity: number;
  responsible?: string | null | undefined;
  notes?: string | null | undefined;
}

/** `POST /inventory/transfers`. */
export function createTransfer(
  csrfToken: string,
  input: TransferInput,
): Promise<{ transferId: number }> {
  return request<{ transferId: number }>(`${BASE}/inventory/transfers`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

export interface WriteOffInput {
  materialId: number;
  locationId: number;
  conditionCode: string;
  quantity: number;
  reason: string;
  authorizedBy: string;
}

/** `POST /inventory/writeoffs`. */
export function createWriteOff(
  csrfToken: string,
  input: WriteOffInput,
): Promise<{ writeoffId: number }> {
  return request<{ writeoffId: number }>(`${BASE}/inventory/writeoffs`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export interface PersonRow {
  id: number;
  full_name: string;
  rut: string | null;
  quality_id: number | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  join_date: string | null;
  registry_no: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  history: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PositionRow {
  id: number;
  person_id: number;
  position_type_id: number | null;
  position_label: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface PersonAssignmentLine {
  id: number;
  assignment_id: number;
  material_id: number;
  unit_id: number | null;
  code: string;
  item_name: string;
  size: string | null;
  serial: string | null;
  quantity: number;
  returned_qty: number;
  condition_out: string | null;
  batch_id: string;
  delivered_at: string;
  delivered_by: string | null;
}

export interface PersonDetail {
  person: PersonRow;
  positions: PositionRow[];
  assignments: PersonAssignmentLine[];
}

export interface PositionType {
  id: number;
  name: string;
}

export interface Quality {
  id: number;
  name: string;
}

export interface PersonsCatalog {
  positionTypes: PositionType[];
  qualities: Quality[];
}

/** `GET /persons`. */
export function fetchPersons(q?: string, signal?: AbortSignal): Promise<PersonRow[]> {
  return request<PersonRow[]>(`${BASE}/persons${query({ q })}`, { signal });
}

export interface CreatePersonInput {
  fullName: string;
  rut?: string | null | undefined;
  qualityId?: number | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  joinDate?: string | null | undefined;
  registryNo?: string | null | undefined;
  emergencyName?: string | null | undefined;
  emergencyPhone?: string | null | undefined;
  history?: string | null | undefined;
  isActive?: boolean | undefined;
}

/** `POST /persons`. */
export function createPerson(
  csrfToken: string,
  input: CreatePersonInput,
): Promise<{ id: number }> {
  return request<{ id: number }>(`${BASE}/persons`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

/** `GET /persons/:id`. */
export function fetchPersonDetail(id: number, signal?: AbortSignal): Promise<PersonDetail> {
  return request<PersonDetail>(`${BASE}/persons/${id}`, { signal });
}

/** `GET /persons/catalog`. */
export function fetchPersonsCatalog(signal?: AbortSignal): Promise<PersonsCatalog> {
  return request<PersonsCatalog>(`${BASE}/persons/catalog`, { signal });
}

export interface CreatePositionInput {
  positionTypeId?: number | null | undefined;
  positionLabel?: string | null | undefined;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  notes?: string | null | undefined;
}

/** `POST /persons/:id/positions`. */
export function createPosition(
  csrfToken: string,
  personId: number,
  input: CreatePositionInput,
): Promise<{ id: number }> {
  return request<{ id: number }>(`${BASE}/persons/${personId}/positions`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}

export interface AssignmentLineInput {
  materialId: number;
  unitId?: number | null | undefined;
  locationId: number;
  quantity: number;
  conditionOut?: string | null | undefined;
}

export interface CreateAssignmentInput {
  deliveredBy: string;
  notes?: string | null | undefined;
  lines: AssignmentLineInput[];
}

/** `POST /persons/:id/assignments`. */
export function createAssignment(
  csrfToken: string,
  personId: number,
  input: CreateAssignmentInput,
): Promise<{ assignmentId: number; batchId: string; lines: number }> {
  return request<{ assignmentId: number; batchId: string; lines: number }>(
    `${BASE}/persons/${personId}/assignments`,
    { method: 'POST', csrfToken, body: input },
  );
}

export interface ReturnLineInput {
  assignmentLineId: number;
  quantity: number;
}

export interface CreateReturnInput {
  receivedBy: string;
  toLocationId: number;
  conditionCode: string;
  notes?: string | null | undefined;
  lines: ReturnLineInput[];
}

/** `POST /persons/:id/returns`. */
export function createReturn(
  csrfToken: string,
  personId: number,
  input: CreateReturnInput,
): Promise<{ returnId: number; lines: number }> {
  return request<{ returnId: number; lines: number }>(`${BASE}/persons/${personId}/returns`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}
