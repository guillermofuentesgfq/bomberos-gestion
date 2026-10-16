/**
 * Tipos de los bindings y variables de entorno del Worker.
 *
 * Los secretos llegan como variables de entorno (Worker secrets), nunca
 * incrustados en el código ni en `wrangler.jsonc`.
 */
export interface Env {
  /** Base de datos relacional de la institución. */
  DB: D1Database;
  /** Bucket R2 privado para imágenes y adjuntos. */
  FILES: R2Bucket;
  /** Assets estáticos (SPA compilada) servidos por Cloudflare. */
  ASSETS: Fetcher;

  /** "production" | "development" */
  APP_ENV: string;

  /** Pimiento (pepper) que se mezcla en el hash de contraseñas. */
  AUTH_PASSWORD_PEPPER?: string;
  /** Secreto para derivar/firmar tokens de sesión. */
  AUTH_SESSION_SECRET?: string;
  /** Token de un solo uso para inicializar el primer administrador. */
  BOOTSTRAP_TOKEN?: string;
}

/** Variables almacenadas en el contexto de la petición. */
export interface Variables {
  requestId: string;
}
