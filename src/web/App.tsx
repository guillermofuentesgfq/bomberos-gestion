import { useState } from 'react';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from './lib/session';
import { RouterProvider, useRoute } from './lib/router';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { PublicApp } from './pages/public/PublicApp';
import {
  ActaBajaPage,
  ActaEntregaPage,
  AdminLayout,
  ContentAdminPage,
  InventoryCatalogPage,
  InventoryPage,
  InventoryPrintPage,
  MovementsPage,
  PersonDetailPage,
  PersonFichaPage,
  PersonsCatalogPage,
  PersonsPage,
  ReportsPage,
  SettingsPage,
  UsersPage,
} from './admin';

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
      <p role="status" className="text-lg text-ink-muted">
        Cargando…
      </p>
    </main>
  );
}

/** Normaliza `/panel…` a `/admin…` para que la navegación marque la sección. */
function normalizeAdminPath(path: string): string {
  const clean = path.split('?')[0] ?? path;
  if (clean === '/panel' || clean === '/admin') return '/admin/inventario';
  if (clean.startsWith('/panel/')) return `/admin/${clean.slice('/panel/'.length)}`;
  return clean;
}

/** Panel administrativo con su shell de navegación. */
function AdminPanel() {
  const { user, csrfToken, logout } = useSession();
  const { path } = useRoute();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user || !csrfToken) return null;

  const currentPath = normalizeAdminPath(path);

  // Las actas son documentos imprimibles: se sirven sueltas, sin el shell del
  // panel, para que la impresión no arrastre la navegación ni la cabecera.
  const actaEntrega = /^\/admin\/actas\/entrega\/(\d+)\/(.+)$/.exec(currentPath);
  if (actaEntrega?.[1] !== undefined && actaEntrega[2] !== undefined) {
    return (
      <ActaEntregaPage
        personId={Number(actaEntrega[1])}
        batchId={decodeURIComponent(actaEntrega[2])}
      />
    );
  }

  const actaBaja = /^\/admin\/actas\/baja\/(\d+)$/.exec(currentPath);
  if (actaBaja?.[1] !== undefined) {
    return <ActaBajaPage writeoffId={Number(actaBaja[1])} />;
  }

  // El inventario imprimible también es un documento suelto, sin el shell.
  if (currentPath === '/admin/informes/inventario') {
    return <InventoryPrintPage />;
  }

  // La ficha del integrante se imprime: documento suelto, sin el shell.
  const fichaMatch = /^\/admin\/personas\/(\d+)\/ficha$/.exec(currentPath);
  if (fichaMatch?.[1] !== undefined) {
    return <PersonFichaPage personId={Number(fichaMatch[1])} />;
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  const personMatch = /^\/admin\/personas\/(\d+)$/.exec(currentPath);
  const personId = personMatch?.[1] ? Number(personMatch[1]) : null;

  let content: ReactNode;
  if (personId !== null) {
    content = <PersonDetailPage csrfToken={csrfToken} personId={personId} />;
  } else if (currentPath === '/admin/personas') {
    content = <PersonsPage csrfToken={csrfToken} />;
  } else if (currentPath === '/admin/personas/catalogo') {
    content = <PersonsCatalogPage csrfToken={csrfToken} />;
  } else if (currentPath === '/admin/movimientos') {
    content = <MovementsPage />;
  } else if (currentPath === '/admin/contenido') {
    content = <ContentAdminPage csrfToken={csrfToken} />;
  } else if (currentPath === '/admin/informes') {
    content = <ReportsPage />;
  } else if (currentPath === '/admin/usuarios') {
    content = <UsersPage csrfToken={csrfToken} />;
  } else if (currentPath === '/admin/ajustes') {
    content = <SettingsPage csrfToken={csrfToken} />;
  } else if (currentPath === '/admin/inventario/catalogo') {
    content = <InventoryCatalogPage csrfToken={csrfToken} />;
  } else {
    content = <InventoryPage csrfToken={csrfToken} />;
  }

  return (
    <AdminLayout
      user={{
        username: user.username,
        displayName: user.displayName,
        roles: user.roles,
        permissions: user.permissions,
      }}
      csrfToken={csrfToken}
      onLogout={handleLogout}
      currentPath={currentPath}
    >
      {loggingOut ? <p role="status" className="text-lg text-ink-muted">Cerrando sesión…</p> : content}
    </AdminLayout>
  );
}

/** Decide la vista del panel según el estado de la instalación y de la sesión. */
function SessionGate() {
  const { status, user, needsSetup } = useSession();

  if (status === 'loading') return <LoadingScreen />;
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;
  // Si la cuenta debe cambiar la contraseña, la API bloquea el resto: se atiende
  // ese paso antes de entrar al panel.
  if (user.mustChangePassword) return <DashboardPage />;
  return <AdminPanel />;
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
