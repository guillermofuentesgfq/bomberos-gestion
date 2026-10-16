import { useEffect } from 'react';

/**
 * SEO del sitio público en una SPA.
 *
 * Actualiza el título del documento, la descripción y las etiquetas Open Graph.
 * Las etiquetas que dejan de aplicar se eliminan para no arrastrar metadatos de
 * la página anterior. El idioma se fija en `es`.
 */

function applyMeta(
  attribute: 'name' | 'property',
  key: string,
  content: string | null,
): void {
  const selector = `meta[${attribute}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (content === null) {
    if (existing) existing.remove();
    return;
  }
  const element = existing ?? document.createElement('meta');
  if (!existing) {
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

/** Convierte una ruta relativa en absoluta para las etiquetas Open Graph. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${window.location.origin}${path}`;
}

export interface SeoInput {
  title?: string | undefined;
  description?: string | null | undefined;
  image?: string | null | undefined;
  type?: string | undefined;
  url?: string | undefined;
}

/** Aplica los metadatos SEO de la página actual. */
export function useSeo(input: SeoInput): void {
  const { title, description, image, type, url } = input;

  useEffect(() => {
    if (title) document.title = title;
    applyMeta('name', 'description', description ?? null);
    applyMeta('property', 'og:title', title ?? null);
    applyMeta('property', 'og:description', description ?? null);
    applyMeta('property', 'og:image', image ? absoluteUrl(image) : null);
    applyMeta('property', 'og:type', type ?? null);
    applyMeta('property', 'og:url', url ? absoluteUrl(url) : null);
    applyMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    document.documentElement.lang = 'es';
  }, [title, description, image, type, url]);
}

/** Aplica los colores institucionales configurados a los tokens de marca. */
export function useBrandColors(primary: string | null | undefined, secondary: string | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    if (primary) root.style.setProperty('--brand-primary', primary);
    if (secondary) root.style.setProperty('--brand-secondary', secondary);
  }, [primary, secondary]);
}
