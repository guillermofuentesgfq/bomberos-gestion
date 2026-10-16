/** Fecha y hora actual en ISO-8601 UTC con precisión de segundos. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Suma segundos a una fecha ISO y devuelve ISO. */
export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Indica si una fecha ISO ya pasó respecto a `reference` (por defecto, ahora). */
export function isPast(iso: string | null | undefined, reference: string = nowIso()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= new Date(reference).getTime();
}
