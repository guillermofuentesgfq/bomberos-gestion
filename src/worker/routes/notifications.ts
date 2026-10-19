/**
 * Rutas de configuración de notificaciones (Ajustes → Notificaciones).
 *
 * El token del bot viaja solo de subida: la respuesta nunca lo devuelve. Leer
 * la configuración exige `institution.read`; cambiarla o probarla, el permiso
 * de escritura institucional, que en los roles iniciales solo tiene el
 * administrador.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import {
  clearTelegramToken,
  getNotificationSettings,
  listNotificationLog,
  saveTelegramSettings,
  sendTestMessage,
} from '../services/notifications';

type AppEnv = { Bindings: Env; Variables: Variables };

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get('/telegram', requireAuth, requirePermission('institution.read'), async (c) => {
  const [settings, log] = await Promise.all([
    getNotificationSettings(c.env.DB),
    listNotificationLog(c.env.DB, 20),
  ]);
  return ok(c, { settings, log });
});

notificationRoutes.put(
  '/telegram',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const body = await readJson(
      c,
      z.object({
        enabled: z.boolean(),
        chatId: z.string().trim().max(120),
        includeContact: z.boolean(),
        token: z.string().trim().max(200).optional(),
      }),
    );
    const settings = await saveTelegramSettings(
      c.env.DB,
      c.env.AUTH_SESSION_SECRET,
      {
        enabled: body.enabled,
        chatId: body.chatId,
        includeContact: body.includeContact,
        token: body.token,
      },
      actorFrom(c),
    );
    return ok(c, { settings });
  },
);

notificationRoutes.delete(
  '/telegram/token',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const settings = await clearTelegramToken(c.env.DB, actorFrom(c));
    return ok(c, { settings });
  },
);

notificationRoutes.post(
  '/telegram/test',
  requireAuth,
  requireCsrf,
  requirePermission('institution.write'),
  async (c) => {
    const result = await sendTestMessage(c.env, actorFrom(c));
    return ok(c, result);
  },
);
