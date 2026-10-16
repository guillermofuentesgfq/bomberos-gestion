import { SessionProvider, useSession } from './lib/session';
import { RouterProvider, useRoute } from './lib/router';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { PublicApp } from './pages/public/PublicApp';

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

/** Decide la vista del panel según el estado de la instalación y de la sesión. */
function SessionGate() {
  const { status, user, needsSetup } = useSession();

  if (status === 'loading') return <LoadingScreen />;
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;
  return <DashboardPage />;
}

/** Rutas que pertenecen al panel administrativo. */
const ADMIN_PREFIXES = ['/admin', '/panel', '/login', '/setup'];

function isAdminPath(path: string): boolean {
  const clean = path.split('?')[0] ?? path;
  return ADMIN_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}

/** Panel administrativo: asistente → login → panel. */
function AdminApp() {
  return (
    <SessionProvider>
      <SkipLink />
      <SessionGate />
    </SessionProvider>
  );
}

/** Decide entre el panel (`/admin`, `/login`…) y el sitio público. */
function AppRoutes() {
  const { path } = useRoute();
  if (isAdminPath(path)) return <AdminApp />;
  return <PublicApp />;
}

/**
 * Composición raíz: router + superficie activa. El panel conserva su flujo de
 * autenticación; el resto de rutas sirven el sitio público.
 */
export function App() {
  return (
    <RouterProvider>
      <AppRoutes />
    </RouterProvider>
  );
}
