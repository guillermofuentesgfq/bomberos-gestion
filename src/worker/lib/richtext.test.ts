import { describe, expect, it } from 'vitest';
import { richTextToPlain, richTextToSummary, sanitizeRichText } from './richtext';

describe('sanitizeRichText', () => {
  it('conserva el formato permitido', () => {
    const html = '<p>Hola <strong>mundo</strong> y <em>cía</em></p><ul><li>uno</li><li>dos</li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('elimina guiones de script junto con su contenido', () => {
    const result = sanitizeRichText('<p>antes</p><script>alert(1)</script><p>después</p>');
    expect(result).toBe('<p>antes</p><p>después</p>');
    expect(result).not.toContain('alert');
  });

  it('elimina estilos, iframes y svg con su contenido', () => {
    const result = sanitizeRichText(
      '<style>p{color:red}</style><iframe src="//malo"></iframe><svg><circle/></svg><p>ok</p>',
    );
    expect(result).toBe('<p>ok</p>');
  });

  it('descarta los atributos, incluidos los de evento', () => {
    const result = sanitizeRichText('<p class="x" style="color:red" onclick="alert(1)">hola</p>');
    expect(result).toBe('<p>hola</p>');
  });

  it('rechaza enlaces con esquemas peligrosos pero conserva el texto', () => {
    const result = sanitizeRichText('<a href="javascript:alert(1)">pulsa</a>');
    expect(result).toBe('pulsa');
  });

  it('rechaza data: y vbscript:', () => {
    expect(sanitizeRichText('<a href="data:text/html,<script>x</script>">a</a>')).toBe('a');
    expect(sanitizeRichText('<a href="vbscript:msgbox(1)">b</a>')).toBe('b');
  });

  it('acepta enlaces http, https, mailto, tel y relativos, y añade rel', () => {
    expect(sanitizeRichText('<a href="https://bomberos.cl">a</a>')).toBe(
      '<a href="https://bomberos.cl" rel="noopener noreferrer">a</a>',
    );
    expect(sanitizeRichText('<a href="mailto:hola@bomberos.cl">b</a>')).toContain(
      'href="mailto:hola@bomberos.cl"',
    );
    expect(sanitizeRichText('<a href="/contacto">c</a>')).toContain('href="/contacto"');
    expect(sanitizeRichText('<a href="#ancla">d</a>')).toContain('href="#ancla"');
  });

  it('normaliza b→strong e i→em', () => {
    expect(sanitizeRichText('<b>a</b><i>b</i>')).toBe('<strong>a</strong><em>b</em>');
  });

  it('cierra las etiquetas que quedaron abiertas', () => {
    expect(sanitizeRichText('<p>sin cerrar')).toBe('<p>sin cerrar</p>');
    expect(sanitizeRichText('<ul><li>uno')).toBe('<ul><li>uno</li></ul>');
  });

  it('ignora etiquetas de cierre sin apertura', () => {
    expect(sanitizeRichText('hola</p> mundo')).toBe('hola mundo');
  });

  it('escapa el texto suelto y los signos peligrosos', () => {
    expect(sanitizeRichText('5 < 6 y 7 > 2')).toBe('5 &lt; 6 y 7 &gt; 2');
    expect(sanitizeRichText('A & B')).toBe('A &amp; B');
  });

  it('no vuelve a escapar las entidades ya presentes', () => {
    expect(sanitizeRichText('<p>Tom &amp; Jerry</p>')).toBe('<p>Tom &amp; Jerry</p>');
    expect(sanitizeRichText('<p>caf&#39;e</p>')).toBe('<p>caf&#39;e</p>');
  });

  it('deja el texto de una etiqueta desconocida', () => {
    expect(sanitizeRichText('<div><p>texto</p></div>')).toBe('<p>texto</p>');
  });

  it('elimina los comentarios', () => {
    expect(sanitizeRichText('<p>a</p><!-- oculto --><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('trata una entrada vacía o nula como cadena vacía', () => {
    expect(sanitizeRichText('')).toBe('');
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
  });
});

describe('richTextToPlain', () => {
  it('quita las etiquetas y colapsa los espacios', () => {
    expect(richTextToPlain('<p>Hola <strong>mundo</strong></p>\n\n<p>otra</p>')).toBe('Hola mundo otra');
  });

  it('decodifica las entidades habituales', () => {
    expect(richTextToPlain('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3');
  });
});

describe('richTextToSummary', () => {
  it('devuelve el texto tal cual si cabe', () => {
    expect(richTextToSummary('<p>Corto</p>', 40)).toBe('Corto');
  });

  it('recorta por palabra y añade puntos suspensivos', () => {
    const summary = richTextToSummary('<p>uno dos tres cuatro cinco seis siete</p>', 20);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(20);
    expect(summary).not.toContain('<');
  });
});
