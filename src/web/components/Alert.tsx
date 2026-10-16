import type { ReactNode, Ref } from 'react';
import { cx } from '../lib/cx';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  tone?: AlertTone | undefined;
  title?: string | undefined;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
  className?: string | undefined;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-accent bg-accent/10 text-ink',
  success: 'border-emerald-700 bg-emerald-600/10 text-ink',
  warning: 'border-amber-600 bg-amber-500/10 text-ink',
  error: 'border-destructive bg-destructive/10 text-ink',
};

/**
 * Mensaje de estado. Los tonos críticos usan `role="alert"` (anuncio inmediato);
 * los informativos usan `role="status"` (anuncio no urgente).
 */
export function Alert({ tone = 'info', title, children, ref, className }: AlertProps) {
  const critical = tone === 'error' || tone === 'warning';
  return (
    <div
      ref={ref}
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      className={cx(
        'rounded-lg border-2 px-4 py-3 text-base leading-relaxed',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {title ? <p className="mb-1 font-bold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
