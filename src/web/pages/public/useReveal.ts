import { useEffect, useRef, useState } from 'react';

/*
 * Aparición progresiva del contenido al entrar en pantalla.
 *
 * Reglas que respeta este módulo:
 * - Usa `IntersectionObserver`, nunca un escucha de `scroll`.
 * - Anima solo `translate` (propiedad de transformación) y `opacity`: ninguna
 *   propiedad de layout, y ambas se componen en la GPU.
 * - Con `prefers-reduced-motion: reduce`, el bloque nace ya visible y estático:
 *   no hay animación ni un fotograma con el contenido oculto.
 * - El estado "oculto" solo existe en el cliente, así que si el JavaScript no
 *   corre no hay nada que ocultar: el contenido se ve por defecto.
 */

/** ¿El sistema pide menos movimiento? Sin `matchMedia`, se asume que sí. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Observa el nodo devuelto y pasa a `revealed` cuando entra en pantalla.
 *
 * El observer se desconecta en cuanto revela (una sola vez) y también al
 * desmontar. Si `IntersectionObserver` no existe, revela de inmediato.
 */
export function useReveal<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState<boolean>(prefersReducedMotion);

  useEffect(() => {
    const node = ref.current;
    if (!node || revealed) return;

    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return { ref, revealed } as const;
}

/**
 * Clases del bloque que aparece: transición larga con curva propia y un
 * desplazamiento pequeño. Con movimiento reducido el cambio es instantáneo y el
 * bloque queda en su posición final (`motion-reduce:*` como red de seguridad,
 * además del estado inicial ya revelado).
 */
export function revealClass(revealed: boolean): string {
  const base =
    'transition-[translate,opacity] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100';
  return revealed
    ? `${base} translate-y-0 opacity-100`
    : `${base} translate-y-6 opacity-0 will-change-[translate,opacity]`;
}
