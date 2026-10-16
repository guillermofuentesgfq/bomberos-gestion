import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchPublicSite } from '../../lib/publicApi';
import type { PublicSite } from '../../lib/publicApi';
import { useBrandColors } from '../../lib/seo';

/**
 * Carga única de `GET /site` para toda la superficie pública: encabezado, pie y
 * datos de la portada. Las páginas de detalle piden su propio contenido.
 */

export type SiteStatus = 'loading' | 'ready' | 'error';

export interface SiteContextValue {
  status: SiteStatus;
  site: PublicSite | null;
  error: unknown;
  reload: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SiteStatus>('loading');
  const [site, setSite] = useState<PublicSite | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    fetchPublicSite(controller.signal).then(
      (data) => {
        setSite(data);
        setStatus('ready');
      },
      (caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught);
        setStatus('error');
      },
    );
    return () => controller.abort();
  }, [nonce]);

  useBrandColors(site?.institution.primaryColor, site?.institution.secondaryColor);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const value = useMemo<SiteContextValue>(
    () => ({ status, site, error, reload }),
    [status, site, error, reload],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Acceso al contexto del sitio público. Debe usarse dentro de `SiteProvider`. */
export function useSite(): SiteContextValue {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error('useSite debe usarse dentro de SiteProvider.');
  }
  return context;
}
