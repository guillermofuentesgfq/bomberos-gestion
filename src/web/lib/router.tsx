import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

/**
 * Router mínimo sobre la History API, sin dependencias externas.
 *
 * La navegación se centraliza en `navigate()`, que empuja (o reemplaza) una
 * entrada en el historial y notifica a los suscriptores. `RouterProvider`
 * escucha `popstate`, de modo que los botones atrás/adelante del navegador
 * también actualizan la vista.
 */

export interface RouterContextValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean | undefined }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Navega a `to`. Usa `replace: true` para no dejar entrada en el historial. */
export function navigate(to: string, options: { replace?: boolean | undefined } = {}): void {
  if (typeof window === 'undefined') return;
  if (to === currentPath()) return;

  if (options.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  // `pushState`/`replaceState` no disparan `popstate`; lo emitimos para que el
  // proveedor actualice el estado de forma uniforme.
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, left: 0 });
}

/** Suscribe la aplicación a los cambios de ruta. */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string>(() => currentPath());

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNavigate = useCallback(
    (to: string, options: { replace?: boolean | undefined } = {}) => navigate(to, options),
    [],
  );

  return (
    <RouterContext.Provider value={{ path, navigate: handleNavigate }}>
      {children}
    </RouterContext.Provider>
  );
}

/** Ruta actual y helper de navegación. Debe usarse dentro de `RouterProvider`. */
export function useRoute(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRoute debe usarse dentro de RouterProvider.');
  }
  return context;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children: ReactNode;
}

/** Enlace interno que navega sin recargar la página. */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // Respeta la apertura en nueva pestaña y los modificadores del teclado.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
