import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { formatDate, formatDateRange } from '../../lib/format';
import { toPlainText } from '../../lib/richtext';
import { useSeo } from '../../lib/seo';
import type {
  PublicActivitySummary,
  PublicGallerySummary,
  PublicImage,
  PublicNewsSummary,
} from '../../lib/publicApi';
import { AppLink, Container } from './SiteChrome';
import { useSite } from './SiteContext';
import { revealClass, useReveal } from './useReveal';

/*
 * Movimiento del sitio público.
 *
 * La curva es propia (rápida al salir, larga al frenar) y las duraciones son
 * amplias; nunca `ease-in-out` ni cambios instantáneos. Los bloques entran con
 * un fundido hacia arriba (ver `useReveal`). Las tarjetas usan `.card-frame`
 * (index.css): marco exterior con borde de un pelo y radio grande; dentro,
 * `.card-frame-inner` con su propio fondo y radio concéntrico, y una sombra muy
 * difusa. Todo anima solo transformaciones (`translate`/`scale`), `opacity` y
 * color; nunca propiedades de layout.
 */
const CARD_HOVER =
  'transition-[translate,border-color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-accent focus-within:border-accent motion-safe:hover:-translate-y-1 motion-safe:focus-within:-translate-y-1 motion-reduce:transition-none';

const CARD_MEDIA_ZOOM = 'motion-safe:group-hover/card:scale-[1.03]';

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
  const { ref, revealed } = useReveal<HTMLDivElement>();
  return (
    <section
      id={id}
      className={cx(
        'scroll-mt-32 py-16 sm:py-24 lg:py-32',
        tone === 'muted' ? 'bg-muted' : 'bg-surface',
      )}
    >
      <Container>
        <div ref={ref} className={revealClass(revealed)}>
          <h2 className="max-w-[70ch] text-3xl leading-[1.05] font-bold text-balance text-ink sm:text-4xl lg:text-5xl">
            {title}
          </h2>
          {intro ? (
            <p className="mt-5 max-w-[68ch] text-lg leading-relaxed text-ink-muted sm:text-xl">
              {intro}
            </p>
          ) : null}
          <div className="mt-12 sm:mt-16">{children}</div>
        </div>
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
  const base =
    'object-cover transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none';
  if (!image) {
    return <div aria-hidden="true" className={cx('bg-muted', base, className)} />;
  }
  return (
    <img
      src={image.url}
      alt={image.alt ?? altFallback}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={cx(base, className)}
    />
  );
}

/*
 * Botón tipo píldora con el icono anidado en su propio círculo. Al pasar el
 * ratón el círculo se desplaza en diagonal; al pulsar, el botón se hunde un
 * poco. Con movimiento reducido, ambos efectos desaparecen.
 */
function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-4 w-4">
      <path
        d="M4.5 10h10m0 0-4-4m4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type PillVariant = 'primary' | 'outline' | 'onCover';

const PILL_VARIANTS: Record<PillVariant, { shell: string; circle: string }> = {
  primary: {
    shell: 'bg-accent text-white hover:bg-accent-strong',
    circle: 'bg-white/20 text-white',
  },
  outline: {
    shell: 'border border-line bg-surface text-ink hover:bg-muted',
    circle: 'bg-muted text-ink',
  },
  onCover: {
    shell: 'border border-white/60 bg-white/10 text-white hover:bg-white/20',
    circle: 'bg-white/20 text-white',
  },
};

function PillLink({
  to,
  children,
  variant = 'primary',
}: {
  to: string;
  children: ReactNode;
  variant?: PillVariant;
}) {
  const tokens = PILL_VARIANTS[variant];
  return (
    <AppLink
      to={to}
      className={cx(
        'group inline-flex min-h-12 items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-6 text-base font-semibold',
        'transition-[scale,background-color,border-color,color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
        'active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
        tokens.shell,
      )}
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          'transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
          'motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5',
          'motion-reduce:transition-none',
          tokens.circle,
        )}
      >
        <ArrowIcon />
      </span>
    </AppLink>
  );
}

function NewsCard({ item }: { item: PublicNewsSummary }) {
  const date = formatDate(item.publishedAt);
  return (
    <article className={cx('card-frame group/card h-full', CARD_HOVER)}>
      <div className="card-frame-inner flex flex-col">
        <Media
          image={item.cover}
          altFallback={item.title}
          className={cx('aspect-[16/10] w-full', CARD_MEDIA_ZOOM)}
        />
        <div className="flex flex-1 flex-col gap-3 p-6 sm:p-7">
          {date ? <p className="text-sm text-ink-muted">{date}</p> : null}
          <h3 className="text-xl leading-tight font-bold text-balance text-ink sm:text-2xl">
            <AppLink to={`/noticias/${item.slug}`} className="hover:text-accent-strong">
              {item.title}
            </AppLink>
          </h3>
          {item.summary ? (
            <div
              className="richtext richtext-inline max-w-[62ch] text-base leading-relaxed text-ink-muted"
              dangerouslySetInnerHTML={{ __html: item.summary }}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ActivityCard({ item }: { item: PublicActivitySummary }) {
  const date = formatDateRange(item.startsAt, item.endsAt);
  return (
    <article className={cx('card-frame group/card h-full', CARD_HOVER)}>
      <div className="card-frame-inner flex flex-col">
        <Media
          image={item.cover}
          altFallback={item.title}
          className={cx('aspect-[16/10] w-full', CARD_MEDIA_ZOOM)}
        />
        <div className="flex flex-1 flex-col gap-3 p-6 sm:p-7">
          {date ? <p className="text-sm font-semibold text-accent-strong">{date}</p> : null}
          <h3 className="text-xl leading-tight font-bold text-balance text-ink sm:text-2xl">
            <AppLink to={`/actividades/${item.slug}`} className="hover:text-accent-strong">
              {item.title}
            </AppLink>
          </h3>
          {item.locationText ? (
            <p className="text-sm text-ink-muted">{item.locationText}</p>
          ) : null}
          {item.summary ? (
            <div
              className="richtext richtext-inline max-w-[62ch] text-base leading-relaxed text-ink-muted"
              dangerouslySetInnerHTML={{ __html: item.summary }}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function GalleryCard({ item }: { item: PublicGallerySummary }) {
  return (
    <article className={cx('card-frame group/card h-full', CARD_HOVER)}>
      <AppLink to={`/galerias/${item.slug}`} className="card-frame-inner flex h-full flex-col">
        <Media
          image={item.cover}
          altFallback={item.title}
          className={cx('aspect-[4/3] w-full', CARD_MEDIA_ZOOM)}
        />
        <div className="flex flex-1 flex-col gap-2 p-6 sm:p-7">
          <h3 className="text-xl leading-tight font-bold text-balance text-ink group-hover/card:text-accent-strong sm:text-2xl">
            {item.title}
          </h3>
          {item.description ? (
            <div
              className="richtext richtext-inline max-w-[62ch] text-base leading-relaxed text-ink-muted"
              dangerouslySetInnerHTML={{ __html: item.description }}
            />
          ) : null}
          <p className="mt-1 text-sm text-ink-muted">
            {item.photoCount === 1 ? '1 fotografía' : `${item.photoCount} fotografías`}
          </p>
        </div>
      </AppLink>
    </article>
  );
}

/** Mensaje de estado vacío cuando la institución aún no publica contenido. */
export function EmptySite() {
  return (
    <Container className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5 px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-4xl leading-[1.05] font-bold text-balance text-ink sm:text-5xl">
        Sitio en preparación
      </h1>
      <p className="max-w-[62ch] text-lg leading-relaxed text-pretty text-ink-muted">
        Esta institución todavía no ha publicado su información. Cuando el equipo
        complete la configuración institucional y publique contenido, aparecerá aquí.
      </p>
      <p className="text-base text-ink-muted">
        Si eres parte del cuerpo, puedes{' '}
        <AppLink
          to="/admin"
          className="font-semibold text-accent-strong underline underline-offset-2"
        >
          entrar al panel administrativo
        </AppLink>{' '}
        para configurarlo.
      </p>
    </Container>
  );
}

/*
 * Texto claro del bloque enriquecido de la portada cuando hay foto de fondo.
 *
 * `.richtext` (sin capa) fija su propio color y el de enlaces, encabezados y
 * citas, así que una utilidad normal pierde la cascada: se necesita `!` para
 * garantizar el blanco sobre el velo oscuro (contraste AA). El enlace conserva
 * su subrayado; solo cambia el color.
 */
const HERO_RICHTEXT_ON_COVER =
  'text-white! [&_a]:text-white! [&_blockquote]:text-white! [&_h2]:text-white! [&_h3]:text-white! [&_h4]:text-white!';

function HeroSection() {
  const { site } = useSite();
  const { ref, revealed } = useReveal<HTMLDivElement>();
  if (!site) return null;
  const { institution } = site;
  const name = institution.name.trim() || 'Cuerpo de Bomberos';
  const specialties = institution.specialties;
  const cover = institution.cover;
  // `site.sections` llega ya filtrado por `is_enabled`, así que una clave
  // ausente es una sección desactivada. Los CTA del héroe apuntan a esas
  // secciones: sin este filtro, un ancla rota (`/#contact`) y un enlace a una
  // sección oculta quedaban visibles igual.
  const enabled = new Set(site.sections.map((section) => section.key));
  const showContact = enabled.has('contact');
  const showNews = enabled.has('news');

  return (
    <section
      id="inicio"
      className={cx(
        'scroll-mt-32 border-b border-line',
        cover
          ? 'relative isolate flex min-h-[68svh] items-center overflow-hidden py-24 sm:min-h-[76svh] sm:py-32'
          : 'bg-muted py-20 sm:py-28 lg:py-32',
      )}
    >
      {cover ? (
        <>
          <img
            src={cover.url}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-b from-brand-secondary/75 via-brand-secondary/80 to-brand-secondary/95"
          />
        </>
      ) : null}

      <Container>
        <div
          ref={ref}
          className={cx(
            revealClass(revealed),
            'flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between',
          )}
        >
          <div className="flex max-w-[62ch] flex-col gap-6">
            <h1
              className={cx(
                'text-5xl leading-[1.02] font-bold text-balance sm:text-6xl lg:text-7xl',
                cover ? 'text-white' : 'text-ink',
              )}
            >
              {name}
            </h1>
            {institution.number ? (
              <p
                className={cx(
                  'inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold',
                  cover
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-brand bg-brand/5 text-brand',
                )}
              >
                {institution.number}
              </p>
            ) : null}
            {toPlainText(institution.description, 1) ? (
              <div
                className={cx(
                  'richtext max-w-[62ch] text-lg leading-relaxed sm:text-xl',
                  cover ? HERO_RICHTEXT_ON_COVER : 'text-ink-muted',
                )}
                dangerouslySetInnerHTML={{ __html: institution.description }}
              />
            ) : null}
            {showContact || showNews ? (
              <div className="flex flex-wrap gap-3 pt-1">
                {showContact ? <PillLink to="/#contact">Contacto</PillLink> : null}
                {showNews ? (
                  <PillLink to="/noticias" variant={cover ? 'onCover' : 'outline'}>
                    Noticias
                  </PillLink>
                ) : null}
              </div>
            ) : null}
            {specialties.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {specialties.slice(0, 6).map((specialty) => (
                  <li
                    key={specialty}
                    className={cx(
                      'rounded-full border px-3.5 py-1.5 text-sm font-semibold',
                      cover
                        ? 'border-white/30 bg-white/10 text-white'
                        : 'border-line bg-surface text-ink',
                    )}
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
                className={cx(
                  'h-44 w-44 object-contain sm:h-60 sm:w-60',
                  cover ? 'drop-shadow-lg' : undefined,
                )}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-44 w-44 items-center justify-center rounded-[var(--radius-card)] border text-6xl font-bold sm:h-60 sm:w-60',
                  cover
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-line bg-surface text-brand',
                )}
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
    (text) => toPlainText(text, 1) !== null,
  );
  if (paragraphs.length === 0) return null;
  return (
    <SectionShell id="about" title="La compañía">
      <div className="flex max-w-[70ch] flex-col gap-6">
        {paragraphs.map((html, index) => (
          <div
            key={index}
            className="richtext text-lg leading-relaxed text-ink-muted sm:text-xl"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))}
      </div>
    </SectionShell>
  );
}

function HistorySection() {
  const { site } = useSite();
  if (!site) return null;
  const { institution } = site;
  if (toPlainText(institution.history, 1) === null) return null;
  return (
    <SectionShell id="history" title="Nuestra historia" tone="muted">
      <div
        className="richtext max-w-[70ch] text-lg leading-relaxed text-ink-muted sm:text-xl"
        dangerouslySetInnerHTML={{ __html: institution.history }}
      />
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
  ].filter((block) => toPlainText(block.text, 1) !== null);
  if (blocks.length === 0) return null;
  return (
    <SectionShell id="mission" title="Misión, visión y valores">
      <div className="grid gap-6 md:grid-cols-3">
        {blocks.map((block) => (
          <div key={block.title} className="card-frame h-full">
            <div className="card-frame-inner flex flex-col gap-3 p-7 sm:p-8">
              <h3 className="text-2xl leading-tight font-bold text-ink">{block.title}</h3>
              <div
                className="richtext text-base leading-relaxed text-ink-muted"
                dangerouslySetInnerHTML={{ __html: block.text }}
              />
            </div>
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
          <li key={specialty} className="rounded-full border border-line bg-muted p-1">
            <span className="block rounded-full border border-line bg-surface px-5 py-2.5 text-base font-semibold text-ink">
              {specialty}
            </span>
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
      <div className="flex flex-col gap-10">
        <div className="grid gap-6 md:grid-cols-3">
          {galleries.map((gallery) => (
            <GalleryCard key={gallery.slug} item={gallery} />
          ))}
        </div>
        <div>
          <PillLink to="/galerias" variant="outline">
            Ver todas las galerías
          </PillLink>
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
      <div className="flex flex-col gap-10">
        <div className="grid gap-6 md:grid-cols-3">
          {site.news.map((item) => (
            <NewsCard key={item.slug} item={item} />
          ))}
        </div>
        <div>
          <PillLink to="/noticias" variant="outline">
            Ver todas las noticias
          </PillLink>
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
      <div className="flex flex-col gap-10">
        <div className="grid gap-6 md:grid-cols-3">
          {site.activities.map((item) => (
            <ActivityCard key={item.slug} item={item} />
          ))}
        </div>
        <div>
          <PillLink to="/actividades" variant="outline">
            Ver todas las actividades
          </PillLink>
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
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-8">
          {location.length > 0 ? (
            <address className="text-lg leading-relaxed not-italic text-ink sm:text-xl">
              {location.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : null}
          {institution.phones.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink-muted">Teléfonos</p>
              <ul className="flex flex-col gap-1.5">
                {institution.phones.map((phone) => (
                  <li key={phone}>
                    <a
                      className="text-lg text-accent-strong underline-offset-4 hover:underline"
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
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink-muted">Correos</p>
              <ul className="flex flex-col gap-1.5">
                {institution.emails.map((email) => (
                  <li key={email}>
                    <a
                      className="text-lg text-accent-strong underline-offset-4 hover:underline"
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
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink-muted">Redes sociales</p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                {institution.socials.map((social) => (
                  <li key={`${social.network}-${social.url}`}>
                    <a
                      className="text-lg font-semibold text-accent-strong underline-offset-4 hover:underline"
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

        <div className="card-frame h-full">
          <div className="card-frame-inner flex h-full flex-col justify-center gap-4 p-8 sm:p-10">
            <p className="text-sm font-semibold text-ink-muted">Emergencias</p>
            {institution.emergencyNumber ? (
              <a
                className="text-6xl leading-none font-bold text-brand underline-offset-4 hover:underline sm:text-7xl"
                href={`tel:${institution.emergencyNumber}`}
              >
                {institution.emergencyNumber}
              </a>
            ) : null}
            <p className="max-w-[46ch] text-base leading-relaxed text-ink-muted">
              Ante una emergencia, llame al número de Bomberos de su localidad.
            </p>
            {!hasDetails ? (
              <p className="text-base leading-relaxed text-ink-muted">
                La institución aún no ha registrado datos de contacto adicionales.
              </p>
            ) : null}
          </div>
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
    description: site?.seo.description || toPlainText(site?.institution.description, 160) || null,
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
      toPlainText(institution.description, 1) ||
      toPlainText(institution.history, 1) ||
      toPlainText(institution.mission, 1) ||
      toPlainText(institution.vision, 1) ||
      toPlainText(institution.values, 1) ||
      toPlainText(institution.corpsInfo, 1) ||
      institution.specialties.length > 0 ||
      site.news.length > 0 ||
      site.activities.length > 0 ||
      site.galleries.length > 0 ||
      site.pages.length > 0,
  );
}
