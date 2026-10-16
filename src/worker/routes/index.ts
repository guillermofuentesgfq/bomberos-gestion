import { Hono } from 'hono';
import type { Env, Variables } from '../lib/env';
import { ok } from '../lib/http';
import { attachContext } from '../security/middleware';
import { authRoutes } from './auth';

/** Router de la API v1. Aquí se montan los módulos por dominio. */
export const api = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Sonda de salud. No expone datos internos ni configuración y no requiere
 * sesión. Se registra antes del middleware de contexto para no tocar la base.
 */
api.get('/health', (c) =>
  ok(c, {
    status: 'ok',
    time: new Date().toISOString(),
    version: '0.1.0',
  }),
);

// Las respuestas de la API nunca se cachean.
api.use('*', async (c, next) => {
  c.header('cache-control', 'no-store');
  await next();
});

// A partir de aquí, todas las rutas cargan identidad, sesión y hash de IP.
api.use('*', attachContext);

api.route('/auth', authRoutes);
