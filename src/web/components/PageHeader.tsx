import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}

/**
 * Encabezado de página.
 *
 * Sin etiquetas *kicker*: la jerarquía la sostienen el tamaño y el peso del
 * titular, no un rótulo pequeño en mayúsculas colocado encima.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl leading-tight font-bold text-balance text-ink">{title}</h1>
          {description ? (
            <p className="max-w-[65ch] text-lg text-pretty text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
