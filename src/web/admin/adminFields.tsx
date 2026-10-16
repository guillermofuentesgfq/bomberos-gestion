/**
 * Campos de formulario compartidos por las pantallas del panel.
 *
 * Reutilizan los tokens de `index.css` y el mismo contrato visual que
 * `TextField` (etiqueta asociada, ayuda, error inline con `aria-describedby`).
 * No duplican componentes existentes: añaden solo los controles que el panel
 * necesita (`select`, `textarea`, `checkbox`) y un mensaje de estado.
 */

import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../lib/cx';

const CONTROL_CLASSES =
  'min-h-11 w-full rounded-lg border bg-surface px-4 py-3 text-base text-ink transition-colors duration-200 ease-out';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
}

/** Campo de selección con etiqueta, ayuda y error inline. */
export function SelectField({
  label,
  id,
  hint,
  error,
  options,
  placeholder,
  className,
  required,
  ...rest
}: SelectFieldProps) {
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
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(CONTROL_CLASSES, error ? 'border-destructive' : 'border-line', className)}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

/** Área de texto con el mismo contrato de accesibilidad que `SelectField`. */
export function TextAreaField({
  label,
  id,
  hint,
  error,
  className,
  required,
  rows = 3,
  ...rest
}: TextAreaFieldProps) {
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
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(CONTROL_CLASSES, error ? 'border-destructive' : 'border-line', className)}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  id?: string | undefined;
  hint?: string | undefined;
}

/** Casilla con etiqueta clicable y objetivo táctil de 44 px. */
export function CheckboxField({ label, id, hint, className, ...rest }: CheckboxFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
        <input
          id={fieldId}
          type="checkbox"
          aria-describedby={hint ? hintId : undefined}
          className={cx('h-5 w-5 shrink-0 cursor-pointer accent-accent', className)}
          {...rest}
        />
        <span className="font-semibold">{label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Mensaje de estado no urgente, anunciado a lectores de pantalla. */
export function StatusMessage({
  children,
  busy = false,
}: {
  children: ReactNode;
  busy?: boolean | undefined;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy={busy ? true : undefined}
      className="text-base text-ink-muted"
    >
      {children}
    </p>
  );
}
