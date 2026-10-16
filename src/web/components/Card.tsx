import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CardProps {
  children: ReactNode;
  className?: string | undefined;
  as?: 'div' | 'section' | undefined;
}

/** Superficie elevada para agrupar contenido relacionado. */
export function Card({ children, className, as = 'div' }: CardProps) {
  const Tag = as;
  return (
    <Tag
      className={cx(
        'rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
