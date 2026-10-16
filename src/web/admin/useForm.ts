/**
 * Controlador de formulario reutilizable para el panel.
 *
 * Concentra los cuatro estados que repiten todas las pantallas: valores,
 * errores por campo, error general y envío en curso. `applyError` traduce un
 * `ApiError` a errores por campo (cuando el servidor envía `issues` con una
 * ruta simple) y mueve el foco al resumen de error para que se anuncie.
 */

import { useCallback, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { ApiError } from '../lib/api';

export interface FormController<T> {
  values: T;
  setValues: Dispatch<SetStateAction<T>>;
  /** Fusiona un subconjunto de campos sobre los valores actuales. */
  patch: (partial: Partial<T>) => void;
  /** Errores por campo del servidor (`issues`) o de validación local. */
  fieldErrors: Record<string, string>;
  setFieldErrors: (errors: Record<string, string>) => void;
  generalError: string | null;
  setGeneralError: (message: string | null) => void;
  submitting: boolean;
  setSubmitting: (value: boolean) => void;
  /** Referencia al contenedor del error general, para mover el foco. */
  errorRef: RefObject<HTMLDivElement | null>;
  applyError: (error: unknown) => void;
  reset: (next?: T) => void;
}

export function useForm<T extends object>(initial: T): FormController<T> {
  const [values, setValues] = useState<T>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const patch = useCallback((partial: Partial<T>) => {
    setValues((previous) => ({ ...previous, ...partial }));
  }, []);

  const reset = useCallback(
    (next?: T) => {
      setValues(next ?? initial);
      setFieldErrors({});
      setGeneralError(null);
      setSubmitting(false);
    },
    [initial],
  );

  const applyError = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      const mapped: Record<string, string> = {};
      for (const issue of error.issues) {
        // Solo se adjuntan rutas simples ("name"); las anidadas ("lines.0.x")
        // se muestran en el resumen general.
        if (!issue.path.includes('.')) mapped[issue.path] = issue.message;
      }
      setFieldErrors(mapped);
      setGeneralError(error.message || 'No se pudo completar la operación.');
    } else {
      setGeneralError('Ocurrió un error inesperado. Inténtalo de nuevo.');
    }
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }, []);

  return {
    values,
    setValues,
    patch,
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    submitting,
    setSubmitting,
    errorRef,
    applyError,
    reset,
  };
}
