import type { Context } from 'hono';
import type { Env, Variables } from '../lib/env';

/** Identidad que ejecuta una operación (para auditoría y movimientos). */
export interface Actor {
  userId: number | null;
  label: string | null;
  ipHash: string | null;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/** Construye el `Actor` a partir del contexto de la petición. */
export function actorFrom(c: AppContext): Actor {
  const user = c.get('user');
  return {
    userId: user?.id ?? null,
    label: user?.username ?? null,
    ipHash: c.get('ipHash'),
  };
}
