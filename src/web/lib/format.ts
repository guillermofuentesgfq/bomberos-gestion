/** Utilidades de formato para el sitio público. */

const DATE_FORMATTER = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Santiago',
});

/** Fecha legible en español de Chile, o `null` si no hay fecha válida. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

/** Rango de fechas legible; devuelve una sola fecha si coinciden o falta una. */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from && to && from !== to) return `${from} — ${to}`;
  return from ?? to;
}
