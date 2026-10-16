import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

/**
 * Campo de texto con etiqueta asociada, ayuda y mensaje de error inline.
 *
 * La ayuda va **debajo** del control: así el campo siempre empieza pegado a su
 * etiqueta y varios campos en columnas quedan alineados aunque unos tengan
 * ayuda y otros no.
 */
export function TextField({
  label,
  id,
  hint,
  error,
  className,
  required,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = cx(hint ? hintId : null, error ? errorId : null) || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-semibold text-ink">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'min-h-11 w-full rounded-lg border bg-surface px-4 py-3 text-base text-ink transition-colors duration-200 ease-out',
          error ? 'border-destructive' : 'border-line',
          className,
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
