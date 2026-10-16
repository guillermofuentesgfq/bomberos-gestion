/**
 * Saneado de HTML enriquecido.
 *
 * El contenido del sitio se escribe con un editor visual, así que se guarda
 * como HTML. Como el sitio público lo inserta directamente en el documento,
 * este módulo lo sanea **en el servidor, al guardar**: es la única defensa real
 * contra XSS almacenado y no depende de que el cliente se comporte bien.
 *
 * No usa el DOM (los Workers no lo tienen) ni ninguna dependencia: recorre la
 * cadena con un tokenizador mínimo y reconstruye solo lo permitido.
 */

/** Etiquetas que sobreviven al saneado. */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'code',
  'pre',
  'hr',
]);

/** Se normalizan a su equivalente semántico. */
const ALIASES: Record<string, string> = { b: 'strong', i: 'em', del: 's', strike: 's' };

/** Etiquetas vacías: no llevan cierre. */
const VOID_TAGS = new Set(['br', 'hr']);

/** Etiquetas cuyo contenido se descarta por completo, no solo la etiqueta. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'title',
  'textarea',
  'form',
  'button',
  'select',
]);

/** Tope defensivo: el esquema ya limita los cuerpos a 100 000 caracteres. */
const MAX_LENGTH = 200_000;

/** Longitud máxima de una URL aceptada en un enlace. */
const MAX_HREF_LENGTH = 2_000;

/**
 * Escapa el texto pero **respeta las entidades ya presentes** (`&amp;`, `&#39;`…).
 * Si no lo hiciera, el `&` de una entidad se volvería a escapar y el texto
 * acabaría mostrándose como `&amp;amp;`.
 */
function escapeText(text: string): string {
  return text
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Solo `http`, `https`, `mailto`, `tel` o rutas relativas y anclas. */
function isSafeUrl(url: string): boolean {
  const value = url.trim();
  if (value.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return /^(https?|mailto|tel):/i.test(value);
  }
  return true;
}

/**
 * Encuentra el `>` que cierra la etiqueta, ignorando los que estén dentro de un
 * valor entrecomillado (`<a href="…>…">`). Devuelve `-1` si no hay cierre.
 */
function findTagEnd(source: string, lt: number): number {
  let quote: string | null = null;
  for (let i = lt + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

/** Extrae un `href` seguro de la cadena de atributos, o `null`. */
function extractHref(attributes: string): string | null {
  const match = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? match[3] ?? '';
  const value = raw.replace(/&amp;/gi, '&').trim();
  if (!isSafeUrl(value)) return null;
  return value.slice(0, MAX_HREF_LENGTH);
}

/**
 * Devuelve el HTML equivalente pero restringido a la lista blanca. Todo lo que
 * no esté permitido se descarta; el texto siempre se conserva escapado.
 */
export function sanitizeRichText(input: string | null | undefined): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const source = input.length > MAX_LENGTH ? input.slice(0, MAX_LENGTH) : input;

  let output = '';
  const open: string[] = [];
  let index = 0;

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      output += escapeText(source.slice(index));
      break;
    }
    if (lt > index) output += escapeText(source.slice(index, lt));

    // Comentario: se descarta entero.
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      index = end === -1 ? source.length : end + 3;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) {
      // Un `<` suelto es texto, no una etiqueta.
      output += escapeText(source.slice(lt));
      break;
    }

    const raw = source.slice(lt + 1, gt);
    const closing = raw.startsWith('/');
    const body = closing ? raw.slice(1) : raw;
    const nameMatch = /^\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(body);
    if (!nameMatch?.[1]) {
      // No es una etiqueta (`5 < 6 y 7 > 2`): es texto, y se conserva escapado.
      output += escapeText(source.slice(lt, gt + 1));
      index = gt + 1;
      continue;
    }

    index = gt + 1;

    const rawName = nameMatch[1].toLowerCase();
    const name = ALIASES[rawName] ?? rawName;

    // Etiquetas peligrosas: se descarta también su contenido.
    if (DROP_WITH_CONTENT.has(rawName)) {
      if (!closing && !/\/\s*$/.test(body)) {
        const closer = new RegExp(`</\\s*${rawName}\\s*>`, 'i');
        const rest = source.slice(index);
        const found = closer.exec(rest);
        index = found ? index + found.index + found[0].length : source.length;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) continue;

    if (VOID_TAGS.has(name)) {
      if (!closing) output += `<${name}>`;
      continue;
    }

    if (closing) {
      const position = open.lastIndexOf(name);
      if (position === -1) continue;
      while (open.length > position) {
        const tag = open.pop();
        if (tag !== undefined) output += `</${tag}>`;
      }
      continue;
    }

    if (name === 'a') {
      const href = extractHref(body);
      // Un enlace sin destino válido se descarta, pero su texto permanece.
      if (href === null) continue;
      output += `<a href="${escapeAttribute(href)}" rel="noopener noreferrer">`;
      open.push('a');
      continue;
    }

    output += `<${name}>`;
    open.push(name);
  }

  // Cierra lo que quedó abierto para no romper el resto de la página.
  while (open.length > 0) {
    const tag = open.pop();
    if (tag !== undefined) output += `</${tag}>`;
  }

  return output;
}

/** Texto plano: para metadatos, listados y cualquier contexto sin formato. */
export function richTextToPlain(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resumen corto en texto plano, cortado por palabra. */
export function richTextToSummary(html: string | null | undefined, maxLength = 160): string {
  const plain = richTextToPlain(html);
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${trimmed}…`;
}
