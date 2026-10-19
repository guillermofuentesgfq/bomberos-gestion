/**
 * Clases compartidas por los controles de formulario.
 *
 * Inputs y `select` nativos no miden igual aunque compartan relleno: algunos
 * navegadores (Safari en macOS, por ejemplo) ignoran el relleno vertical del
 * `select` y lo dejan más bajo que un `input` con las mismas clases. Por eso
 * los controles de una línea fijan su alto explícitamente y comparten una
 * única definición: así no vuelven a desalinearse.
 */
export const CONTROL_BASE_CLASSES =
  'w-full rounded-lg border bg-surface px-4 text-base text-ink transition-colors duration-200 ease-out';

/** Alto común a `input` y `select` de una línea: 48 px, sobre el mínimo táctil de 44. */
export const SINGLE_LINE_CONTROL_CLASSES = `${CONTROL_BASE_CLASSES} h-12`;

/** Las áreas de texto conservan alto flexible y su propio relleno vertical. */
export const TEXTAREA_CONTROL_CLASSES = `${CONTROL_BASE_CLASSES} min-h-11 py-3`;
