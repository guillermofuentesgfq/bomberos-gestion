/**
 * Foto de un material para listados y documentos.
 *
 * La imagen se sirve con sesión desde `/api/v1/files/:id`. Cuando el material no
 * tiene foto, el listado muestra un marcador que lo indica; los documentos
 * imprimibles lo dejan en blanco para no gastar tinta.
 */

import { cx } from '../lib/cx';

export interface MaterialPhotoProps {
  photoObjectId: number | null;
  name: string;
  /** Clases de tamaño y radio del marco. */
  className: string;
  /** Sustituye la ausencia de foto por un marcador visible (solo pantalla). */
  placeholder?: boolean | undefined;
}

export function MaterialPhoto({
  photoObjectId,
  name,
  className,
  placeholder = false,
}: MaterialPhotoProps) {
  if (photoObjectId === null) {
    if (!placeholder) return null;

    return (
      <svg
        viewBox="0 0 40 40"
        role="img"
        aria-label="Sin foto"
        className={cx(className, 'shrink-0 border border-line bg-muted text-ink-muted')}
      >
        <rect
          x="10"
          y="12"
          width="20"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="15" cy="17" r="1.5" fill="currentColor" />
        <path
          d="M11 25.5l5-5 4.5 4.5 3-3 5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8.5 8.5l23 23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <img
      src={`/api/v1/files/${photoObjectId}`}
      alt={`Foto de ${name}`}
      className={cx(className, 'shrink-0 border border-line object-cover')}
    />
  );
}
