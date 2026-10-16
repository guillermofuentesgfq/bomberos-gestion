/** Une clases condicionales eliminando valores vacíos. Sin dependencias. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}
