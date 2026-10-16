import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  changePassword as changePasswordRequest,
  fetchAuthStatus,
  login as loginRequest,
  logout as logoutRequest,
  setup as setupRequest,
} from './api';
import type { AuthStatus, AuthUser, SetupInput } from './api';

/** Mientras se consulta `/auth/status` el estado es `loading`; luego `ready`. */
export type SessionStatus = 'loading' | 'ready';

export interface SessionContextValue {
  status: SessionStatus;
  user: AuthUser | null;
  csrfToken: string | null;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (input: SetupInput) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Provee el estado de sesión a la aplicación. Al montar consulta `/auth/status`. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const applyStatus = useCallback((next: AuthStatus) => {
    setNeedsSetup(next.needsSetup);
    setUser(next.authenticated ? next.user : null);
    setCsrfToken(next.authenticated ? next.csrfToken : null);
    setStatus('ready');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuthStatus(controller.signal)
      .then(applyStatus)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Si no se puede consultar el estado, se asume sesión no iniciada.
        setUser(null);
        setCsrfToken(null);
        setStatus('ready');
      });
    return () => controller.abort();
  }, [applyStatus]);

  const refresh = useCallback(async () => {
    try {
      applyStatus(await fetchAuthStatus());
    } catch {
      setUser(null);
      setCsrfToken(null);
      setStatus('ready');
    }
  }, [applyStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await loginRequest(username, password);
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setNeedsSetup(false);
    setStatus('ready');
  }, []);

  const setup = useCallback(async (input: SetupInput) => {
    const data = await setupRequest(input);
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setNeedsSetup(false);
    setStatus('ready');
  }, []);

  const logout = useCallback(async () => {
    const token = csrfToken;
    try {
      if (token) await logoutRequest(token);
    } catch {
      // Aunque el servidor no responda, se cierra la sesión localmente.
    } finally {
      setUser(null);
      setCsrfToken(null);
    }
  }, [csrfToken]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!csrfToken) {
        throw new ApiError('forbidden', 403, 'La sesión no está disponible.');
      }
      await changePasswordRequest(csrfToken, { currentPassword, newPassword });
      setUser((previous) => (previous ? { ...previous, mustChangePassword: false } : previous));
    },
    [csrfToken],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ status, user, csrfToken, needsSetup, login, setup, logout, changePassword, refresh }),
    [status, user, csrfToken, needsSetup, login, setup, logout, changePassword, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Acceso al contexto de sesión. Debe usarse dentro de `SessionProvider`. */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession debe usarse dentro de SessionProvider.');
  }
  return context;
}
