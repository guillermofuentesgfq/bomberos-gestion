import { Hono } from 'hono';
import type { Env, Variables } from '../lib/env';
import { json } from '../lib/http';

/** Router de la API v1. Aquí se montan los módulos por dominio. */
export const api = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Sonda de salud. No expone datos internos ni configuración.
 * Se usa para verificar el despliegue y para el chequeo post-instalación.
 */
api.get('/health', () =>
  json({
    status: 'ok',
    time: new Date().toISOString(),
    version: '0.1.0',
  }),
);
