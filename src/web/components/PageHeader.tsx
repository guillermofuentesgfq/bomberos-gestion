import type { ReactNode } from 'react';

export interface PageHeaderProps {
  eyebrow?: string | undefined;
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}

/** Encabezado de página: contexto breve, título y acciones principales. */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          {eyebrow ? (
            <p className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl leading-tight font-bold text-ink">{title}</h1>
          {description ? (
            <p className="max-w-[65ch] text-base text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
