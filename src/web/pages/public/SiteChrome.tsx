import type { ReactNode } from 'react';
import { Link } from '../../lib/router';
import { useSite } from './SiteContext';
import type { SocialLink } from '../../lib/publicApi';

/** Contenedor de ancho de lectura para el sitio público. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ?? 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8'}>
      {children}
    </div>
  );
}

interface NavItem {
  label: string;
  href: string;
}

/** Etiquetas y destinos de navegación por clave de sección. */
const SECTION_NAV: Record<string, NavItem> = {
  hero: { label: 'Inicio', href: '/#inicio' },
  about: { label: 'La compañía', href: '/#about' },
  history: { label: 'Historia', href: '/#history' },
  mission: { label: 'Misión', href: '/#mission' },
  specialties: { label: 'Especialidades', href: '/#specialties' },
  gallery: { label: 'Galería', href: '/galerias' },
  news: { label: 'Noticias', href: '/noticias' },
  activities: { label: 'Actividades', href: '/actividades' },
  contact: { label: 'Contacto', href: '/#contact' },
};

/** Enlace interno que respeta los anclajes de la portada. */
export function AppLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  if (to.startsWith('/#')) {
    return (
      <a href={to} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase());
  return letters.join('') || 'BG';
}

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  twitter: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  web: 'Sitio web',
};

function socialLabel(social: SocialLink): string {
  return SOCIAL_LABELS[social.network.toLowerCase()] ?? social.network;
}

/** Encabezado institucional con escudo, nombre y navegación por secciones. */
export function SiteHeader() {
  const { site } = useSite();
  if (!site) return null;

  const { institution, sections, pages } = site;

  const navItems: NavItem[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const item = SECTION_NAV[section.key];
    if (!item || seen.has(item.href)) continue;
    navItems.push(item);
    seen.add(item.href);
  }
  for (const page of pages) {
    const href = `/paginas/${page.slug}`;
    if (seen.has(href)) continue;
    navItems.push({ label: page.title, href });
    seen.add(href);
  }

  const displayName = institution.name.trim() || 'Cuerpo de Bomberos';

  return (
    <header className="border-b border-line bg-surface">
      <Container className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <AppLink to="/" className="flex items-center gap-3">
          {institution.shield ? (
            <img
              src={institution.shield.url}
              alt={institution.shield.alt ?? `Escudo de ${displayName}`}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white"
            >
              {initials(displayName)}
            </span>
          )}
          <span className="flex flex-col">
            <span className="text-lg leading-tight font-bold text-ink">{displayName}</span>
            {institution.number ? (
              <span className="text-sm text-ink-muted">{institution.number}</span>
            ) : null}
          </span>
        </AppLink>

        <nav aria-label="Navegación principal">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {navItems.map((item) => (
              <li key={item.href}>
                <AppLink
                  to={item.href}
                  className="inline-flex min-h-11 items-center text-base font-semibold text-ink transition-colors duration-200 ease-out hover:text-accent-strong"
                >
                  {item.label}
                </AppLink>
              </li>
            ))}
            <li>
              <AppLink
                to="/admin"
                className="inline-flex min-h-11 items-center text-base text-ink-muted transition-colors duration-200 ease-out hover:text-ink"
              >
                Panel
              </AppLink>
            </li>
          </ul>
        </nav>
      </Container>
    </header>
  );
}

/** Pie institucional con contacto, navegación y enlace al panel. */
export function SiteFooter() {
  const { site } = useSite();
  if (!site) return null;

  const { institution } = site;
  const displayName = institution.name.trim() || 'Cuerpo de Bomberos';
  const year = new Date().getFullYear();
  const location = [institution.commune, institution.region, institution.country]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');

  return (
    <footer className="border-t border-line bg-muted">
      <Container className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
        <div className="flex flex-col gap-3">
          <p className="text-lg font-bold text-ink">{displayName}</p>
          {institution.number ? <p className="text-sm text-ink-muted">{institution.number}</p> : null}
          {institution.description ? (
            <p className="max-w-[60ch] text-sm text-ink-muted">{institution.description}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-base font-bold text-ink">Contacto</h2>
          {institution.emergencyNumber ? (
            <p className="text-base text-ink">
              Emergencias:{' '}
              <a
                className="font-semibold text-accent-strong underline-offset-2 hover:underline"
                href={`tel:${institution.emergencyNumber}`}
              >
                {institution.emergencyNumber}
              </a>
            </p>
          ) : null}
          {institution.emails.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {institution.emails.map((email) => (
                <li key={email}>
                  <a
                    className="text-sm text-accent-strong underline-offset-2 hover:underline"
                    href={`mailto:${email}`}
                  >
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {location ? <p className="text-sm text-ink-muted">{location}</p> : null}
          {institution.socials.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {institution.socials.map((social) => (
                <li key={`${social.network}-${social.url}`}>
                  <a
                    className="text-sm font-semibold text-accent-strong underline-offset-2 hover:underline"
                    href={social.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {socialLabel(social)}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-base font-bold text-ink">Institución</h2>
          <ul className="flex flex-col gap-1">
            <li>
              <AppLink to="/noticias" className="text-sm text-ink hover:text-accent-strong">
                Noticias
              </AppLink>
            </li>
            <li>
              <AppLink to="/actividades" className="text-sm text-ink hover:text-accent-strong">
                Actividades
              </AppLink>
            </li>
            <li>
              <AppLink to="/galerias" className="text-sm text-ink hover:text-accent-strong">
                Galerías
              </AppLink>
            </li>
            <li>
              <AppLink to="/admin" className="text-sm text-ink hover:text-accent-strong">
                Acceso del personal
              </AppLink>
            </li>
          </ul>
          <p className="text-xs text-ink-muted">
            © {year} {displayName}. Sistema de gestión institucional.
          </p>
        </div>
      </Container>
    </footer>
  );
}
