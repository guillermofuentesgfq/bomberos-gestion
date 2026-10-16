import { SELF, env } from 'cloudflare:test';
import { hashPassword } from '../src/worker/security/passwords';

export interface FieldIssue {
  path: string;
  message: string;
}

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; issues?: FieldIssue[] };
}

export interface ApiResponse<T> {
  status: number;
  body: Envelope<T>;
  headers: Headers;
  /** Cuerpo binario cuando la respuesta no es JSON (por ejemplo, un .xlsx). */
  bytes: ArrayBuffer | null;
}

export const BASE = 'https://bomberos.test';

/** Cliente de API con manejo manual de cookie de sesión y token CSRF. */
export class ApiClient {
  private cookie: string | null = null;
  csrf: string | null = null;

  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; csrf?: boolean; headers?: Record<string, string>; form?: FormData; idempotencyKey?: string } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (this.cookie) headers['cookie'] = this.cookie;
    if (options.csrf && this.csrf) headers['x-csrf-token'] = this.csrf;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await SELF.fetch(`${BASE}${path}`, { method, headers, ...(body ? { body } : {}) });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const first = setCookie.split(';')[0] ?? '';
      this.cookie = first.includes('Max-Age=0') ? null : first;
    }

    const contentType = response.headers.get('content-type') ?? '';
    let parsed: Envelope<T>;
    let bytes: ArrayBuffer | null = null;
    if (contentType.includes('application/json')) {
      const text = await response.text();
      parsed = text ? (JSON.parse(text) as Envelope<T>) : { ok: response.ok };
    } else {
      // Respuestas binarias (por ejemplo, un archivo o un .xlsx).
      bytes = await response.arrayBuffer();
      parsed = { ok: response.ok };
    }
    if (parsed.ok && parsed.data && typeof parsed.data === 'object' && 'csrfToken' in parsed.data) {
      const token = (parsed.data as { csrfToken: string | null }).csrfToken;
      if (token) this.csrf = token;
    }
    return { status: response.status, body: parsed, headers: response.headers, bytes };
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown, options: { idempotencyKey?: string } = {}) {
    return this.request<T>('POST', path, { body, csrf: true, ...options });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body, csrf: true });
  }
  del<T = unknown>(path: string) {
    return this.request<T>('DELETE', path, { csrf: true });
  }

  async setupAdmin(password = 'ContrasenaAdmin123', token = 'token-de-pruebas'): Promise<void> {
    const response = await this.request('POST', '/api/v1/auth/setup', {
      body: { token, username: 'admin', password, displayName: 'Administrador' },
    });
    if (response.status !== 201) {
      throw new Error(`No se pudo inicializar el administrador: ${response.status}`);
    }
  }

  async login(username: string, password: string): Promise<number> {
    const response = await this.request('POST', '/api/v1/auth/login', { body: { username, password } });
    return response.status;
  }
}

/** Crea un usuario directamente en la base con un rol concreto. */
export async function seedUser(
  username: string,
  password: string,
  roleCode: string,
): Promise<number> {
  const hashed = await hashPassword(password, env.AUTH_PASSWORD_PEPPER);
  const now = new Date().toISOString();
  const created = await env.DB.prepare(
    `INSERT INTO users
       (username, display_name, password_hash, password_salt, password_iterations, password_algo,
        is_active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(username, username, hashed.hash, hashed.salt, hashed.iterations, hashed.algo, now, now)
    .run();
  const userId = Number(created.meta.last_row_id);
  await env.DB.prepare(
    `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?`,
  )
    .bind(userId, roleCode)
    .run();
  return userId;
}

/** Cuenta filas de una tabla (para comprobar que no hubo efectos parciales). */
export async function countRows(table: string, where = '1=1', ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Lee una cantidad de existencias concreta. */
export async function stockOf(
  materialId: number,
  locationId: number,
  conditionCode = 'operativo',
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT quantity FROM stock_levels WHERE material_id = ? AND location_id = ? AND condition_code = ?`,
  )
    .bind(materialId, locationId, conditionCode)
    .first<{ quantity: number }>();
  return row?.quantity ?? 0;
}
