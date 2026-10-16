import { SessionProvider, useSession } from './lib/session';
import { RouterProvider } from './lib/router';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

/** Enlace para saltar al contenido principal con el teclado. */
function SkipLink() {
  return (
    <a href="#contenido" className="skip-link">
      Saltar al contenido
    </a>
  );
}

/** Pantalla mientras se resuelve `/auth/status`. */
function LoadingScreen() {
  return (
    <main
      id="contenido"
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center p-6"
    >
      <p role="status" className="text-base text-ink-muted">
        Cargando…
      </p>
    </main>
  );
}

/** Decide la vista según el estado de la instalación y de la sesión. */
function SessionGate() {
  const { status, user, needsSetup } = useSession();

  if (status === 'loading') return <LoadingScreen />;
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;
  return <DashboardPage />;
}

/**
 * Composición raíz: sesión + router. La vista la determina el estado de sesión
 * (asistente → login → panel); las páginas usan el router para reflejar la
 * navegación en la URL.
 */
export function App() {
  return (
    <SessionProvider>
      <RouterProvider>
        <SkipLink />
        <SessionGate />
      </RouterProvider>
    </SessionProvider>
  );
}
