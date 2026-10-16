/**
 * Shell del panel administrativo.
 *
 * Cabecera con el nombre del usuario y cierre de sesión, navegación entre las
 * secciones (marcando la activa con `aria-current="page"`) y un `<main>`
 * enfocable que sirve de destino al enlace "saltar al contenido" global
 * (`id="contenido"`).
 */

import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { Link } from '../lib/router';
import { cx } from '../lib/cx';

export interface AdminLayoutUser {
  username: string;
  displayName: string | null;
  roles: string[];
}

export interface AdminLayoutProps {
  user: AdminLayoutUser;
  csrfToken: string;
  onLogout: () => void;
  children: ReactNode;
  currentPath: string;
}

export interface AdminSection {
  label: string;
  path: string;
}

/** Rutas de navegación del panel. El flujo que cablea `App.tsx` las enruta. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { label: 'Inventario', path: '/admin/inventario' },
  { label: 'Personas', path: '/admin/personas' },
  { label: 'Movimientos', path: '/admin/movimientos' },
  { label: 'Informes', path: '/admin/informes' },
  { label: 'Contenido', path: '/admin/contenido' },
  { label: 'Ajustes', path: '/admin/ajustes' },
];

/**
 * Sub-secciones por área.
 *
 * Una sección con más de una página necesita su propia barra para que todas
 * sean alcanzables: el catálogo, por ejemplo, quedaba sin ninguna entrada de
 * menú (el único enlace vivía en un aviso que solo se veía con el catálogo
 * vacío) y era inalcanzable en cuanto hubiera un dato creado.
 */
const SUB_NAVS: readonly {
  match: (path: string) => boolean;
  label: string;
  items: readonly AdminSection[];
}[] = [
  {
    match: (path) => isUnder(path, '/admin/inventario'),
    label: 'Secciones de inventario',
    items: [
      { label: 'Materiales', path: '/admin/inventario' },
      { label: 'Catálogo', path: '/admin/inventario/catalogo' },
    ],
  },
  {
    match: (path) => isUnder(path, '/admin/personas'),
    label: 'Secciones de personas',
    items: [
      { label: 'Integrantes', path: '/admin/personas' },
      { label: 'Catálogo', path: '/admin/personas/catalogo' },
    ],
  },
];

/** La ruta está en esa sección o por debajo de ella. */
function isUnder(currentPath: string, base: string): boolean {
  const clean = cleanPath(currentPath);
  return clean === base || clean.startsWith(`${base}/`);
}

/**
 * Sub-sección activa: la coincidencia **más larga**. Así el detalle de una
 * persona (`/admin/personas/5`) marca «Integrantes», y no «Catálogo».
 */
function activeSubPath(currentPath: string, items: readonly AdminSection[]): string | null {
  const clean = cleanPath(currentPath);
  const matches = items
    .filter((item) => clean === item.path || clean.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.path ?? null;
}

function cleanPath(path: string): string {
  return path.split('?')[0] ?? path;
}

/** La sección está activa si la ruta actual coincide o desciende de ella. */
export function isSectionActive(currentPath: string, sectionPath: string): boolean {
  const clean = cleanPath(currentPath);
  return clean === sectionPath || clean.startsWith(`${sectionPath}/`);
}

export function AdminLayout({ user, onLogout, children, currentPath }: AdminLayoutProps) {
  const displayName = user.displayName?.trim() || user.username;

  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink-muted">Panel administrativo</p>
            <p className="text-lg font-bold text-ink">{displayName}</p>
            {user.roles.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <li
                    key={role}
                    className="rounded-md border border-brand bg-brand/5 px-2 py-0.5 text-xs font-semibold text-brand"
                  >
                    {role}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button variant="secondary" onClick={onLogout}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      <nav aria-label="Secciones del panel" className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6">
          <ul className="flex flex-wrap gap-1">
            {ADMIN_SECTIONS.map((section) => {
              const active = isSectionActive(currentPath, section.path);
              return (
                <li key={section.path}>
                  <Link
                    to={section.path}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'inline-flex min-h-11 cursor-pointer items-center border-b-2 px-3 text-base font-semibold transition-colors duration-200 ease-out',
                      active
                        ? 'border-brand text-brand'
                        : 'border-transparent text-ink-muted hover:text-ink',
                    )}
                  >
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Sub-secciones: el catálogo es una página aparte en cada área. */}
      {SUB_NAVS.map(({ match, label, items }) =>
        match(currentPath) ? (
          <nav key={label} aria-label={label} className="border-b border-line bg-muted">
            <div className="mx-auto w-full max-w-6xl px-6">
              <ul className="flex flex-wrap gap-1">
                {items.map((item) => {
                  const active = activeSubPath(currentPath, items) === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'inline-flex min-h-10 cursor-pointer items-center border-b-2 px-3 text-sm font-semibold transition-colors duration-200 ease-out',
                          active
                            ? 'border-brand text-brand'
                            : 'border-transparent text-ink-muted hover:text-ink',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        ) : null,
      )}

      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {children}
      </main>
    </div>
  );
}
