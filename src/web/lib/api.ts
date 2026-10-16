/**
 * Cliente HTTP tipado de la API de autenticación.
 *
 * Todas las respuestas usan el sobre uniforme del Worker:
 *   - éxito: `{ ok: true, data: T }`
 *   - error: `{ ok: false, error: { code, message, issues? } }`
 *
 * La cookie de sesión es `HttpOnly`, así que el navegador la envía con
 * `credentials: 'include'`; el JS nunca la lee. Las operaciones con estado
 * exigen además la cabecera `X-CSRF-Token` con el `csrfToken` de la sesión.
 */

/** Identidad autenticada y sus capacidades (espejo de `AuthUser` del Worker). */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

/** Estado de la instalación y de la sesión actual. */
export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
}

/** Datos de sesión devueltos por login, setup y me. */
export interface SessionData {
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
}

/** Detalle de validación por campo. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** Entrada del asistente de inicialización del primer administrador. */
export interface SetupInput {
  token: string;
  username: string;
  password: string;
  displayName?: string | undefined;
}

/** Entrada del cambio de contraseña. */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
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

/** Nombre del encabezado CSRF exigido por el Worker. */
const CSRF_HEADER = 'x-csrf-token';

const BASE = '/api/v1/auth';

/** Error tipado que envuelve el sobre de error del servidor. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(code: string, status: number, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

interface RequestOptions {
  method?: string | undefined;
  body?: unknown;
  csrfToken?: string | null | undefined;
  signal?: AbortSignal | undefined;
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

/** Ejecuta una petición y resuelve el sobre, o lanza `ApiError`. */
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

/** `GET /auth/status` — público. */
export function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return request<AuthStatus>(`${BASE}/status`, signal ? { signal } : {});
}

/** `POST /auth/login`. */
export function login(username: string, password: string): Promise<SessionData> {
  return request<SessionData>(`${BASE}/login`, {
    method: 'POST',
    body: { username, password },
  });
}

/** `POST /auth/setup` — inicializa el primer administrador (201). */
export function setup(input: SetupInput): Promise<SessionData> {
  const body: Record<string, string> = {
    token: input.token,
    username: input.username,
    password: input.password,
  };
  if (input.displayName !== undefined && input.displayName.trim().length > 0) {
    body.displayName = input.displayName.trim();
  }
  return request<SessionData>(`${BASE}/setup`, { method: 'POST', body });
}

/** `POST /auth/logout` — requiere sesión y CSRF. */
export function logout(csrfToken: string): Promise<{ loggedOut: true }> {
  return request<{ loggedOut: true }>(`${BASE}/logout`, { method: 'POST', csrfToken });
}

/** `GET /auth/me` — requiere sesión. */
export function fetchMe(): Promise<SessionData> {
  return request<SessionData>(`${BASE}/me`);
}

/** `POST /auth/password` — requiere sesión y CSRF. */
export function changePassword(
  csrfToken: string,
  input: ChangePasswordInput,
): Promise<{ updated: true }> {
  return request<{ updated: true }>(`${BASE}/password`, {
    method: 'POST',
    csrfToken,
    body: input,
  });
}
