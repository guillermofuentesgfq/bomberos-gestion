import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRoute } from '../../lib/router';
import { SiteProvider } from './SiteContext';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { LandingPage } from './sections';
import {
  ActivityDetailPage,
  ActivityListPage,
  ContentPage,
  GalleryDetailPage,
  GalleryListPage,
  NewsDetailPage,
  NewsListPage,
  NotFoundPage,
} from './ContentPages';

/** Resuelve el contenido a partir de la ruta actual (sin query string). */
function PublicRoutes() {
  const { path } = useRoute();
  const clean = path.split('?')[0] ?? '/';

  // Al entrar con un ancla (`/#about`) el navegador puede resolverla antes de
  // que React monte la sección; se desplaza manualmente una vez renderizada.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView();
  }, [clean]);

  const segments = clean.split('/').filter((segment) => segment.length > 0);
  const first = segments[0];
  const second = segments[1];

  if (segments.length === 0) return <LandingPage />;
  if (segments.length > 2) return <NotFoundPage />;

  switch (first) {
    case 'noticias':
      return second ? <NewsDetailPage slug={second} /> : <NewsListPage />;
    case 'actividades':
      return second ? <ActivityDetailPage slug={second} /> : <ActivityListPage />;
    case 'galerias':
      return second ? <GalleryDetailPage slug={second} /> : <GalleryListPage />;
    case 'paginas':
      return second ? <ContentPage slug={second} /> : <NotFoundPage />;
    default:
      return <NotFoundPage />;
  }
}

/**
 * Superficie pública: encabezado, contenido y pie institucional. Comparte la
 * carga de `GET /site` mediante `SiteProvider`.
 */
export function PublicApp(): ReactNode {
  return (
    <SiteProvider>
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">
        <PublicRoutes />
      </main>
      <SiteFooter />
    </SiteProvider>
  );
}
