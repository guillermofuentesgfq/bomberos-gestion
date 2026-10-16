/**
 * Utilidades para el contenido enriquecido del sitio.
 *
 * El servidor guarda HTML saneado con una lista blanca estricta, así que aquí
 * no se sanea: solo se convierte a texto plano cuando un valor enriquecido debe
 * viajar a un contexto que no admite marcado (por ejemplo, una meta descripción)
 * o cuando hay que decidir si el contenido está vacío.
 */

const TAG_PATTERN = /<[^>]*>/g;

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0*39;/g, "'"],
  [/&#x27;/gi, "'"],
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
];

/**
 * Convierte HTML a texto plano: quita las etiquetas, decodifica las entidades
 * más comunes (el `&amp;` al final para no doble-decodificar), colapsa los
 * espacios y recorta a `maxLength` caracteres con puntos suspensivos.
 *
 * Devuelve `null` si no queda texto, de modo que un cuerpo con solo etiquetas
 * se trate como vacío.
 */
export function toPlainText(value: string | null | undefined, maxLength = 160): string | null {
  if (!value) return null;

  let text = value.replace(TAG_PATTERN, ' ');
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length === 0) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
