import { useEffect, useState } from 'react';

export interface AsyncState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: unknown;
}

/**
 * Ejecuta una carga asíncrona al montar (o cuando cambian `deps`) y expone el
 * estado. Cancela la petición anterior con `AbortController` al desmontar.
 */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });
    load(controller.signal).then(
      (data) => setState({ status: 'ready', data, error: null }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error', data: null, error });
      },
    );
    return () => controller.abort();
    // `deps` es la clave de recarga; `load` se recrea en cada render a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
