import { useEffect, useState } from 'react';

interface HealthPayload {
  status: string;
  time: string;
  version: string;
}

/**
 * Pantalla de arranque. Confirma que el Worker responde y que la SPA está
 * servida desde el mismo origen. La interfaz institucional y el panel se
 * construyen en las fases siguientes sobre el design system.
 */
export function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/health', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data: HealthPayload };
        setHealth(body.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error desconocido');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          Sistema de Gestión
        </p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Instalación lista
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Base preparada para compañías y cuerpos de bomberos. La interfaz
          institucional y el panel administrativo se construyen en las fases
          siguientes.
        </p>
      </header>

      <section
        aria-live="polite"
        className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="mb-2 font-semibold text-slate-800 dark:text-slate-200">
          Estado del servicio
        </h2>
        {error ? (
          <p className="text-red-600 dark:text-red-400">
            No se pudo contactar la API: {error}
          </p>
        ) : health ? (
          <dl className="grid grid-cols-2 gap-2 text-slate-700 dark:text-slate-300">
            <dt className="font-medium">Estado</dt>
            <dd>{health.status}</dd>
            <dt className="font-medium">Versión</dt>
            <dd>{health.version}</dd>
            <dt className="font-medium">Hora del servidor</dt>
            <dd>{new Date(health.time).toLocaleString('es-CL')}</dd>
          </dl>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">Consultando…</p>
        )}
      </section>
    </main>
  );
}
