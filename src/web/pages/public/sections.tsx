import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { formatDate, formatDateRange } from '../../lib/format';
import { useSeo } from '../../lib/seo';
import type {
  PublicActivitySummary,
  PublicGallerySummary,
  PublicImage,
  PublicNewsSummary,
} from '../../lib/publicApi';
import { AppLink, Container } from './SiteChrome';
import { useSite } from './SiteContext';

/** Envoltorio de sección con anclaje y título consistente. */
function SectionShell({
  id,
  title,
  intro,
  children,
  tone = 'surface',
}: {
  id: string;
  title: string;
  intro?: string | undefined;
  children: ReactNode;
  tone?: 'surface' | 'muted';
}) {
  return (
    <section
      id={id}
      className={cx(
        'scroll-mt-6 py-12 sm:py-16',
        tone === 'muted' ? 'bg-muted' : 'bg-surface',
      )}
    >
      <Container>
        <h2 className="max-w-[70ch] text-3xl leading-tight font-bold text-ink">{title}</h2>
        {intro ? <p className="mt-3 max-w-[65ch] text-lg text-ink-muted">{intro}</p> : null}
        <div className="mt-8">{children}</div>
      </Container>
    </section>
  );
}

/** Imagen con carga diferida y texto alternativo; bloque neutro si falta. */
function Media({
  image,
  altFallback,
  className,
}: {
  image: PublicImage | null;
  altFallback: string;
  className?: string | undefined;
}) {
  if (!image) {
    return <div aria-hidden="true" className={cx('bg-muted', className)} />;
  }
  return (
    <img
      src={image.url}
      alt={image.alt ?? altFallback}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={cx('object-cover', className)}
    />
  );
}

function NewsCard({ item }: { item: PublicNewsSummary }) {
  const date = formatDate(item.publishedAt);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm">
      <Media image={item.cover} altFallback={item.title} className="h-44 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        {date ? <p className="text-sm text-ink-muted">{date}</p> : null}
        <h3 className="text-xl leading-tight font-bold text-ink">
          <AppLink to={`/noticias/${item.slug}`} className="hover:text-accent-strong">
            {item.title}
          </AppLink>
        </h3>
        {item.summary ? (
          <p className="max-w-[60ch] text-base text-ink-muted">{item.summary}</p>
        ) : null}
      </div>
    </article>
  );
}

function ActivityCard({ item }: { item: PublicActivitySummary }) {
  const date = formatDateRange(item.startsAt, item.endsAt);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm">
      <Media image={item.cover} altFallback={item.title} className="h-44 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        {date ? <p className="text-sm font-semibold text-accent-strong">{date}</p> : null}
        <h3 className="text-xl leading-tight font-bold text-ink">
          <AppLink to={`/actividades/${item.slug}`} className="hover:text-accent-strong">
            {item.title}
          </AppLink>
        </h3>
        {item.locationText ? (
          <p className="text-sm text-ink-muted">{item.locationText}</p>
        ) : null}
        {item.summary ? (
          <p className="max-w-[60ch] text-base text-ink-muted">{item.summary}</p>
        ) : null}
      </div>
    </article>
  );
}

function GalleryCard({ item }: { item: PublicGallerySummary }) {
  return (
    <AppLink
      to={`/galerias/${item.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm transition-colors duration-200 ease-out hover:border-accent"
    >
      <Media image={item.cover} altFallback={item.title} className="h-48 w-full" />
      <div className="flex flex-1 flex-col gap-1 p-5">
        <h3 className="text-xl leading-tight font-bold text-ink group-hover:text-accent-strong">
          {item.title}
        </h3>
        {item.description ? (
          <p className="max-w-[60ch] text-base text-ink-muted">{item.description}</p>
        ) : null}
        <p className="mt-1 text-sm text-ink-muted">
          {item.photoCount === 1 ? '1 fotografía' : `${item.photoCount} fotografías`}
        </p>
      </div>
    </AppLink>
  );
}

/** Mensaje de estado vacío cuando la institución aún no publica contenido. */
export function EmptySite() {
  return (
    <Container className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-24 sm:px-6 lg:px-8">
      <p className="text-sm font-semibold tracking-widest text-ink-muted uppercase">
        Sitio institucional
      </p>
      <h1 className="text-3xl leading-tight font-bold text-ink sm:text-4xl">
        Sitio en preparación
      </h1>
      <p className="max-w-[60ch] text-lg text-ink-muted">
        Esta institución todavía no ha publicado su información. Cuando el equipo
        complete la configuración institucional y publique contenido, aparecerá aquí.
      </p>
      <p className="text-base text-ink-muted">
        Si eres parte del cuerpo, puedes ingresar al{' '}
        <AppLink to="/admin" className="font-semibold text-accent-strong underline underline-offset-2">
          panel administrativo
        </AppLink>{' '}
        para configurarlo.
      </p>
    </Container>
  );
}

function HeroSection() {
  const { site } = useSite();
  if (!site) return null;
  const { institution } = site;
  const name = institution.name.trim() || 'Cuerpo de Bomberos';
  const specialties = institution.specialties;

  return (
    <section id="inicio" className="scroll-mt-6 border-b border-line bg-muted py-16 sm:py-24">
      <Container>
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-[65ch] flex-col gap-5">
            {institution.number ? (
              <p className="text-sm font-semibold tracking-widest text-brand uppercase">
                {institution.number}
              </p>
            ) : null}
            <h1 className="text-4xl leading-tight font-bold text-ink sm:text-5xl">{name}</h1>
            {institution.description ? (
              <p className="text-lg text-ink-muted">{institution.description}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <AppLink
                to="/#contact"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-6 py-3 text-base font-semibold text-white transition-colors duration-200 ease-out hover:bg-accent-strong"
              >
                Contacto
              </AppLink>
              <AppLink
                to="/noticias"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-brand px-6 py-3 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
              >
                Noticias
              </AppLink>
            </div>
            {specialties.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-2">
                {specialties.slice(0, 6).map((specialty) => (
                  <li
                    key={specialty}
                    className="rounded-md border border-line bg-surface px-3 py-1 text-sm font-semibold text-ink"
                  >
                    {specialty}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-center">
            {institution.shield ? (
              <img
                src={institution.shield.url}
                alt={institution.shield.alt ?? `Escudo de ${name}`}
                width={institution.shield.width ?? undefined}
                height={institution.shield.height ?? undefined}
                className="h-40 w-40 object-contain sm:h-52 sm:w-52"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-40 w-40 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface text-5xl font-bold text-brand sm:h-52 sm:w-52"
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function AboutSection() {
  const { site } = useSite();
  if (!site) return null;
  const { institution } = site;
  const paragraphs = [institution.description, institution.corpsInfo].filter(
    (text) => text.trim().length > 0,
  );
  if (paragraphs.length === 0) return null;
  return (
    <SectionShell id="about" title="La compañía">
      <div className="flex max-w-[68ch] flex-col gap-4">
        {paragraphs.map((text, index) => (
          <p key={index} className="text-lg whitespace-pre-line text-ink-muted">
            {text}
          </p>
        ))}
      </div>
    </SectionShell>
  );
}

function HistorySection() {
  const { site } = useSite();
  if (!site) return null;
  const { institution } = site;
  if (!institution.history.trim()) return null;
  return (
    <SectionShell id="history" title="Nuestra historia" tone="muted">
      <p className="max-w-[68ch] text-lg whitespace-pre-line text-ink-muted">
        {institution.history}
      </p>
    </SectionShell>
  );
}

function MissionSection() {
  const { site } = useSite();
  if (!site) return null;
  const { mission, vision, values } = site.institution;
  const blocks = [
    { title: 'Misión', text: mission },
    { title: 'Visión', text: vision },
    { title: 'Valores', text: values },
  ].filter((block) => block.text.trim().length > 0);
  if (blocks.length === 0) return null;
  return (
    <SectionShell id="mission" title="Misión, visión y valores">
      <div className="grid gap-6 md:grid-cols-3">
        {blocks.map((block) => (
          <div
            key={block.title}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-muted p-6 shadow-sm"
          >
            <h3 className="text-xl font-bold text-ink">{block.title}</h3>
            <p className="text-base whitespace-pre-line text-ink-muted">{block.text}</p>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function SpecialtiesSection() {
  const { site } = useSite();
  if (!site) return null;
  const { specialties } = site.institution;
  if (specialties.length === 0) return null;
  return (
    <SectionShell id="specialties" title="Especialidades" tone="muted">
      <ul className="flex flex-wrap gap-3">
        {specialties.map((specialty) => (
          <li
            key={specialty}
            className="rounded-md border border-line bg-surface px-4 py-2 text-base font-semibold text-ink"
          >
            {specialty}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function GallerySection() {
  const { site } = useSite();
  if (!site) return null;
  const galleries = site.galleries.slice(0, 3);
  if (galleries.length === 0) return null;
  return (
    <SectionShell id="gallery" title="Galería">
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 md:grid-cols-3">
          {galleries.map((gallery) => (
            <GalleryCard key={gallery.slug} item={gallery} />
          ))}
        </div>
        <div>
          <AppLink
            to="/galerias"
            className="text-base font-semibold text-accent-strong underline underline-offset-2"
          >
            Ver todas las galerías
          </AppLink>
        </div>
      </div>
    </SectionShell>
  );
}

function NewsSection() {
  const { site } = useSite();
  if (!site) return null;
  if (site.news.length === 0) return null;
  return (
    <SectionShell id="news" title="Noticias" tone="muted">
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 md:grid-cols-3">
          {site.news.map((item) => (
            <NewsCard key={item.slug} item={item} />
          ))}
        </div>
        <div>
          <AppLink
            to="/noticias"
            className="text-base font-semibold text-accent-strong underline underline-offset-2"
          >
            Ver todas las noticias
          </AppLink>
        </div>
      </div>
    </SectionShell>
  );
}

function ActivitiesSection() {
  const { site } = useSite();
  if (!site) return null;
  if (site.activities.length === 0) return null;
  return (
    <SectionShell id="activities" title="Actividades">
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 md:grid-cols-3">
          {site.activities.map((item) => (
            <ActivityCard key={item.slug} item={item} />
          ))}
        </div>
        <div>
          <AppLink
            to="/actividades"
            className="text-base font-semibold text-accent-strong underline underline-offset-2"
          >
            Ver todas las actividades
          </AppLink>
        </div>
      </div>
    </SectionShell>
  );
}

function ContactSection() {
  const { site } = useSite();
  if (!site) return null;
  const { institution } = site;
  const location = [institution.address, institution.commune, institution.region, institution.country]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const hasDetails =
    location.length > 0 ||
    institution.phones.length > 0 ||
    institution.emails.length > 0 ||
    institution.socials.length > 0;

  return (
    <SectionShell id="contact" title="Contacto" tone="muted">
      <div className="grid gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {location.length > 0 ? (
            <address className="text-lg not-italic text-ink">
              {location.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : null}
          {institution.phones.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
                Teléfonos
              </p>
              <ul className="flex flex-col gap-1">
                {institution.phones.map((phone) => (
                  <li key={phone}>
                    <a
                      className="text-lg text-accent-strong underline-offset-2 hover:underline"
                      href={`tel:${phone}`}
                    >
                      {phone}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {institution.emails.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
                Correos
              </p>
              <ul className="flex flex-col gap-1">
                {institution.emails.map((email) => (
                  <li key={email}>
                    <a
                      className="text-lg text-accent-strong underline-offset-2 hover:underline"
                      href={`mailto:${email}`}
                    >
                      {email}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {institution.socials.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
                Redes sociales
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {institution.socials.map((social) => (
                  <li key={`${social.network}-${social.url}`}>
                    <a
                      className="text-lg font-semibold text-accent-strong underline-offset-2 hover:underline"
                      href={social.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {social.network}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col justify-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm">
          <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
            Emergencias
          </p>
          {institution.emergencyNumber ? (
            <a
              className="text-5xl font-bold text-brand underline-offset-4 hover:underline"
              href={`tel:${institution.emergencyNumber}`}
            >
              {institution.emergencyNumber}
            </a>
          ) : null}
          <p className="text-base text-ink-muted">
            Ante una emergencia, llame al número de Bomberos de su localidad.
          </p>
          {!hasDetails ? (
            <p className="text-base text-ink-muted">
              La institución aún no ha registrado datos de contacto adicionales.
            </p>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

const SECTION_RENDERERS: Record<string, () => ReactNode> = {
  hero: HeroSection,
  about: AboutSection,
  history: HistorySection,
  mission: MissionSection,
  specialties: SpecialtiesSection,
  gallery: GallerySection,
  news: NewsSection,
  activities: ActivitiesSection,
  contact: ContactSection,
};

/** Portada institucional compuesta a partir de `GET /site`. */
export function LandingPage() {
  const { site } = useSite();
  const institutionName = site?.institution.name.trim() || 'Cuerpo de Bomberos';

  useSeo({
    title: site?.seo.title || institutionName,
    description: site?.seo.description || site?.institution.description || null,
    image: site?.seo.ogImage?.url ?? site?.institution.shield?.url ?? null,
    type: 'website',
  });

  if (!site) return null;

  const configured = isConfigured(site);
  if (!configured) return <EmptySite />;

  return (
    <>
      {site.sections.map((section) => {
        const Renderer = SECTION_RENDERERS[section.key];
        if (!Renderer) return null;
        return <Renderer key={section.key} />;
      })}
    </>
  );
}

/** ¿La institución ya publicó algo que merezca una portada real? */
function isConfigured(site: ReturnType<typeof useSite>['site']): boolean {
  if (!site) return false;
  const institution = site.institution;
  return Boolean(
    institution.name.trim() ||
      institution.description.trim() ||
      institution.history.trim() ||
      institution.mission.trim() ||
      institution.vision.trim() ||
      institution.values.trim() ||
      institution.corpsInfo.trim() ||
      institution.specialties.length > 0 ||
      site.news.length > 0 ||
      site.activities.length > 0 ||
      site.galleries.length > 0 ||
      site.pages.length > 0,
  );
}
