import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  loading?: boolean | undefined;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'border-2 border-brand bg-transparent text-brand hover:bg-brand/5',
  danger: 'bg-destructive text-white hover:bg-destructive/90',
};

/**
 * Botón accesible. En `loading` queda deshabilitado, expone `aria-busy` y
 * anuncia el estado al lector de pantalla. Objetivo táctil de 44 px.
 */
export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {loading ? <span className="sr-only">Procesando…</span> : null}
    </button>
  );
}
