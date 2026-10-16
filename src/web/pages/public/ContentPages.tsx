import { ApiError } from '../../lib/api';
import { formatDate, formatDateRange } from '../../lib/format';
import {
  fetchPublicActivityItem,
  fetchPublicActivities,
  fetchPublicGallery,
  fetchPublicGalleries,
  fetchPublicNews,
  fetchPublicNewsItem,
  fetchPublicPage,
} from '../../lib/publicApi';
import { useAsync } from '../../lib/useAsync';
import { useSeo } from '../../lib/seo';
import { AppLink, Container } from './SiteChrome';
import { useSite } from './SiteContext';

/** Contenedor de lectura, más estrecho que la portada. */
const READING_CONTAINER = 'mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8';

function LoadingState() {
  return (
    <Container className={`${READING_CONTAINER}`}>
      <p role="status" className="text-lg text-ink-muted">
        Cargando…
      </p>
    </Container>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Container className={READING_CONTAINER}>
      <h1 className="text-3xl font-bold text-ink">No se pudo cargar</h1>
      <p className="mt-3 max-w-[60ch] text-lg text-ink-muted">{message}</p>
      <p className="mt-6">
        <AppLink
          to="/"
          className="text-base font-semibold text-accent-strong underline underline-offset-2"
        >
          Volver al inicio
        </AppLink>
      </p>
    </Container>
  );
}

/** Página de recurso inexistente: se usa para un slug no publicado o inválido. */
export function NotFoundContent({ message = 'El contenido que buscas no existe o no está publicado.' }: { message?: string }) {
  return (
    <Container className={READING_CONTAINER}>
      <p className="text-sm font-semibold tracking-widest text-ink-muted uppercase">Error 404</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">Contenido no disponible</h1>
      <p className="mt-3 max-w-[60ch] text-lg text-ink-muted">{message}</p>
      <p className="mt-6">
        <AppLink
          to="/"
          className="text-base font-semibold text-accent-strong underline underline-offset-2"
        >
          Volver al inicio
        </AppLink>
      </p>
    </Container>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

/** Página de error de la SPA para rutas desconocidas. */
export function NotFoundPage() {
  useSeo({ title: 'Página no encontrada' });
  return <NotFoundContent />;
}

function useInstitutionName(): string {
  const { site } = useSite();
  return site?.institution.name.trim() || 'Cuerpo de Bomberos';
}

function PageHeading({
  eyebrow,
  title,
  intro,
  backTo,
  backLabel,
}: {
  eyebrow: string;
  title: string;
  intro?: string | undefined;
  backTo?: string | undefined;
  backLabel?: string | undefined;
}) {
  return (
    <header className="border-b border-line pb-6">
      {backTo && backLabel ? (
        <p className="mb-3">
          <AppLink
            to={backTo}
            className="text-sm font-semibold text-accent-strong underline underline-offset-2"
          >
            ← {backLabel}
          </AppLink>
        </p>
      ) : null}
      <p className="text-sm font-semibold tracking-widest text-ink-muted uppercase">{eyebrow}</p>
      <h1 className="mt-2 text-3xl leading-tight font-bold text-ink sm:text-4xl">{title}</h1>
      {intro ? <p className="mt-3 max-w-[65ch] text-lg text-ink-muted">{intro}</p> : null}
    </header>
  );
}

function BodyText({ body }: { body: string | null }) {
  if (!body || body.trim().length === 0) return null;
  return <div className="whitespace-pre-line text-lg text-ink-muted">{body}</div>;
}

// --- Noticias --------------------------------------------------------------

export function NewsListPage() {
  const institutionName = useInstitutionName();
  useSeo({ title: `Noticias — ${institutionName}` });
  const state = useAsync((signal) => fetchPublicNews(100, signal), []);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return <ErrorState message="No se pudieron cargar las noticias. Inténtalo más tarde." />;
  }
  const news = state.data ?? [];

  return (
    <Container className={READING_CONTAINER}>
      <PageHeading
        eyebrow="Actualidad"
        title="Noticias"
        intro="Comunicados, emergencias y novedades de la institución."
      />
      {news.length === 0 ? (
        <p className="mt-8 text-lg text-ink-muted">Todavía no hay noticias publicadas.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-6">
          {news.map((item) => {
            const date = formatDate(item.publishedAt);
            return (
              <li key={item.slug} className="border-b border-line pb-6 last:border-b-0">
                <article className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  {item.cover ? (
                    <img
                      src={item.cover.url}
                      alt={item.cover.alt ?? item.title}
                      width={item.cover.width ?? undefined}
                      height={item.cover.height ?? undefined}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full rounded-[var(--radius-card)] object-cover sm:h-32 sm:w-48"
                    />
                  ) : null}
                  <div className="flex flex-col gap-2">
                    {date ? <p className="text-sm text-ink-muted">{date}</p> : null}
                    <h2 className="text-xl leading-tight font-bold text-ink">
                      <AppLink to={`/noticias/${item.slug}`} className="hover:text-accent-strong">
                        {item.title}
                      </AppLink>
                    </h2>
                    {item.summary ? (
                      <p className="max-w-[65ch] text-base text-ink-muted">{item.summary}</p>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

export function NewsDetailPage({ slug }: { slug: string }) {
  const institutionName = useInstitutionName();
  const state = useAsync((signal) => fetchPublicNewsItem(slug, signal), [slug]);

  const item = state.data;
  useSeo({
    title: item?.seoTitle || (item ? `${item.title} — ${institutionName}` : 'Noticia'),
    description: item?.seoDescription || item?.summary || null,
    image: item?.cover?.url ?? null,
    type: 'article',
  });

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    if (isNotFound(state.error)) {
      return <NotFoundContent message="Esta noticia no existe o no está publicada." />;
    }
    return <ErrorState message="No se pudo cargar la noticia. Inténtalo más tarde." />;
  }
  if (!item) return <NotFoundContent message="Esta noticia no existe o no está publicada." />;

  const date = formatDate(item.publishedAt);

  return (
    <Container className={READING_CONTAINER}>
      <PageHeading
        eyebrow="Noticia"
        title={item.title}
        backTo="/noticias"
        backLabel="Todas las noticias"
      />
      {date ? <p className="mt-4 text-sm text-ink-muted">{date}</p> : null}
      {item.cover ? (
        <img
          src={item.cover.url}
          alt={item.cover.alt ?? item.title}
          width={item.cover.width ?? undefined}
          height={item.cover.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="mt-6 w-full rounded-[var(--radius-card)] object-cover"
        />
      ) : null}
      {item.summary ? <p className="mt-6 text-xl text-ink-muted">{item.summary}</p> : null}
      <div className="mt-6">
        <BodyText body={item.body} />
      </div>
    </Container>
  );
}

// --- Actividades -----------------------------------------------------------

export function ActivityListPage() {
  const institutionName = useInstitutionName();
  useSeo({ title: `Actividades — ${institutionName}` });
  const state = useAsync((signal) => fetchPublicActivities(100, signal), []);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return <ErrorState message="No se pudieron cargar las actividades. Inténtalo más tarde." />;
  }
  const activities = state.data ?? [];

  return (
    <Container className={READING_CONTAINER}>
      <PageHeading
        eyebrow="Agenda"
        title="Actividades"
        intro="Actividades, eventos y actividades comunitarias de la institución."
      />
      {activities.length === 0 ? (
        <p className="mt-8 text-lg text-ink-muted">Todavía no hay actividades publicadas.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-6">
          {activities.map((item) => {
            const date = formatDateRange(item.startsAt, item.endsAt);
            return (
              <li key={item.slug} className="border-b border-line pb-6 last:border-b-0">
                <article className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  {item.cover ? (
                    <img
                      src={item.cover.url}
                      alt={item.cover.alt ?? item.title}
                      width={item.cover.width ?? undefined}
                      height={item.cover.height ?? undefined}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full rounded-[var(--radius-card)] object-cover sm:h-32 sm:w-48"
                    />
                  ) : null}
                  <div className="flex flex-col gap-2">
                    {date ? (
                      <p className="text-sm font-semibold text-accent-strong">{date}</p>
                    ) : null}
                    <h2 className="text-xl leading-tight font-bold text-ink">
                      <AppLink
                        to={`/actividades/${item.slug}`}
                        className="hover:text-accent-strong"
                      >
                        {item.title}
                      </AppLink>
                    </h2>
                    {item.locationText ? (
                      <p className="text-sm text-ink-muted">{item.locationText}</p>
                    ) : null}
                    {item.summary ? (
                      <p className="max-w-[65ch] text-base text-ink-muted">{item.summary}</p>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

export function ActivityDetailPage({ slug }: { slug: string }) {
  const institutionName = useInstitutionName();
  const state = useAsync((signal) => fetchPublicActivityItem(slug, signal), [slug]);

  const item = state.data;
  useSeo({
    title: item ? `${item.title} — ${institutionName}` : 'Actividad',
    description: item?.summary ?? null,
    image: item?.cover?.url ?? null,
    type: 'article',
  });

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    if (isNotFound(state.error)) {
      return <NotFoundContent message="Esta actividad no existe o no está publicada." />;
    }
    return <ErrorState message="No se pudo cargar la actividad. Inténtalo más tarde." />;
  }
  if (!item) return <NotFoundContent message="Esta actividad no existe o no está publicada." />;

  const date = formatDateRange(item.startsAt, item.endsAt);

  return (
    <Container className={READING_CONTAINER}>
      <PageHeading
        eyebrow="Actividad"
        title={item.title}
        backTo="/actividades"
        backLabel="Todas las actividades"
      />
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-base">
        {date ? (
          <div className="flex gap-2">
            <dt className="font-semibold text-ink">Fecha</dt>
            <dd className="text-ink-muted">{date}</dd>
          </div>
        ) : null}
        {item.locationText ? (
          <div className="flex gap-2">
            <dt className="font-semibold text-ink">Lugar</dt>
            <dd className="text-ink-muted">{item.locationText}</dd>
          </div>
        ) : null}
      </dl>
      {item.cover ? (
        <img
          src={item.cover.url}
          alt={item.cover.alt ?? item.title}
          width={item.cover.width ?? undefined}
          height={item.cover.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="mt-6 w-full rounded-[var(--radius-card)] object-cover"
        />
      ) : null}
      {item.summary ? <p className="mt-6 text-xl text-ink-muted">{item.summary}</p> : null}
      <div className="mt-6">
        <BodyText body={item.body} />
      </div>
    </Container>
  );
}

// --- Galerías --------------------------------------------------------------

export function GalleryListPage() {
  const institutionName = useInstitutionName();
  useSeo({ title: `Galerías — ${institutionName}` });
  const state = useAsync((signal) => fetchPublicGalleries(signal), []);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return <ErrorState message="No se pudieron cargar las galerías. Inténtalo más tarde." />;
  }
  const galleries = state.data ?? [];

  return (
    <Container className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <PageHeading
        eyebrow="Memoria visual"
        title="Galerías"
        intro="Registro fotográfico de la actividad institucional."
      />
      {galleries.length === 0 ? (
        <p className="mt-8 text-lg text-ink-muted">Todavía no hay galerías publicadas.</p>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {galleries.map((gallery) => (
            <li key={gallery.slug}>
              <AppLink
                to={`/galerias/${gallery.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm transition-colors duration-200 ease-out hover:border-accent"
              >
                {gallery.cover ? (
                  <img
                    src={gallery.cover.url}
                    alt={gallery.cover.alt ?? gallery.title}
                    width={gallery.cover.width ?? undefined}
                    height={gallery.cover.height ?? undefined}
                    loading="lazy"
                    decoding="async"
                    className="h-48 w-full object-cover"
                  />
                ) : (
                  <div aria-hidden="true" className="h-48 w-full bg-muted" />
                )}
                <div className="flex flex-1 flex-col gap-1 p-5">
                  <h2 className="text-xl leading-tight font-bold text-ink group-hover:text-accent-strong">
                    {gallery.title}
                  </h2>
                  {gallery.description ? (
                    <p className="max-w-[60ch] text-base text-ink-muted">{gallery.description}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-muted">
                    {gallery.photoCount === 1 ? '1 fotografía' : `${gallery.photoCount} fotografías`}
                  </p>
                </div>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

export function GalleryDetailPage({ slug }: { slug: string }) {
  const institutionName = useInstitutionName();
  const state = useAsync((signal) => fetchPublicGallery(slug, signal), [slug]);

  const gallery = state.data;
  useSeo({
    title: gallery ? `${gallery.title} — ${institutionName}` : 'Galería',
    description: gallery?.description ?? null,
    image: gallery?.photos[0]?.url ?? null,
  });

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    if (isNotFound(state.error)) {
      return <NotFoundContent message="Esta galería no existe o no está publicada." />;
    }
    return <ErrorState message="No se pudo cargar la galería. Inténtalo más tarde." />;
  }
  if (!gallery) return <NotFoundContent message="Esta galería no existe o no está publicada." />;

  return (
    <Container className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <PageHeading
        eyebrow="Galería"
        title={gallery.title}
        intro={gallery.description ?? undefined}
        backTo="/galerias"
        backLabel="Todas las galerías"
      />
      {gallery.photos.length === 0 ? (
        <p className="mt-8 text-lg text-ink-muted">Esta galería todavía no tiene fotografías.</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gallery.photos.map((photo) => (
            <li key={photo.id}>
              <figure className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                <img
                  src={photo.url}
                  alt={photo.alt ?? gallery.title}
                  width={photo.width ?? undefined}
                  height={photo.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="h-64 w-full object-cover"
                />
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

// --- Páginas estáticas -----------------------------------------------------

export function ContentPage({ slug }: { slug: string }) {
  const institutionName = useInstitutionName();
  const state = useAsync((signal) => fetchPublicPage(slug, signal), [slug]);

  const page = state.data;
  useSeo({
    title: page?.seoTitle || (page ? `${page.title} — ${institutionName}` : 'Página'),
    description: page?.seoDescription || page?.excerpt || null,
    image: page?.hero?.url ?? null,
  });

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    if (isNotFound(state.error)) {
      return <NotFoundContent message="Esta página no existe o no está publicada." />;
    }
    return <ErrorState message="No se pudo cargar la página. Inténtalo más tarde." />;
  }
  if (!page) return <NotFoundContent message="Esta página no existe o no está publicada." />;

  return (
    <Container className={READING_CONTAINER}>
      <PageHeading eyebrow={institutionName} title={page.title} intro={page.excerpt ?? undefined} />
      {page.hero ? (
        <img
          src={page.hero.url}
          alt={page.hero.alt ?? page.title}
          width={page.hero.width ?? undefined}
          height={page.hero.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="mt-6 w-full rounded-[var(--radius-card)] object-cover"
        />
      ) : null}
      <div className="mt-6">
        <BodyText body={page.body} />
      </div>
    </Container>
  );
}
