import { describe, expect, it } from 'vitest';
import { buildWorkbook, escapeXml, sanitizeCellText } from './xlsx';

const decoder = new TextDecoder();

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Lector mínimo de ZIP: devuelve un mapa nombre → contenido (texto). */
function readEntries(zip: Uint8Array): Map<string, string> {
  const eocdOffset = zip.length - 22;
  const total = readUint16(zip, eocdOffset + 10);
  const centralOffset = readUint32(zip, eocdOffset + 16);

  const files = new Map<string, string>();
  let cursor = centralOffset;
  for (let i = 0; i < total; i += 1) {
    const size = readUint32(zip, cursor + 20);
    const nameLength = readUint16(zip, cursor + 28);
    const extraLength = readUint16(zip, cursor + 30);
    const commentLength = readUint16(zip, cursor + 32);
    const localOffset = readUint32(zip, cursor + 42);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));

    const localNameLength = readUint16(zip, localOffset + 26);
    const localExtraLength = readUint16(zip, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files.set(name, decoder.decode(zip.subarray(dataStart, dataStart + size)));

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('buildWorkbook', () => {
  it('produce un ZIP válido con las partes XML esperadas', () => {
    const zip = buildWorkbook([{ name: 'Datos', rows: [['A', 'B'], [1, 2]] }]);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const files = readEntries(zip);
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('_rels/.rels')).toBe(true);
    expect(files.has('xl/workbook.xml')).toBe(true);
    expect(files.has('xl/_rels/workbook.xml.rels')).toBe(true);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);

    const workbook = files.get('xl/workbook.xml') ?? '';
    expect(workbook).toContain('name="Datos"');
    expect(workbook).toContain('sheetId="1"');

    const sheet = files.get('xl/worksheets/sheet1.xml') ?? '';
    // El texto va como cadena en línea; los números, como números.
    expect(sheet).toContain('<c r="A1" t="inlineStr">');
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain('<c r="B2"><v>2</v></c>');
  });

  it('genera una parte de hoja por cada hoja solicitada', () => {
    const zip = buildWorkbook([
      { name: 'Uno', rows: [['x']] },
      { name: 'Dos', rows: [['y']] },
    ]);
    const files = readEntries(zip);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);
    expect(files.has('xl/worksheets/sheet2.xml')).toBe(true);
    expect(files.get('xl/workbook.xml')).toContain('sheetId="2"');
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml');
  });

  it('escapa caracteres XML en el contenido y en el nombre de la hoja', () => {
    const zip = buildWorkbook([{ name: 'A&B', rows: [['<a> & "b"']] }]);
    const files = readEntries(zip);
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('&lt;a&gt; &amp; &quot;b&quot;');
    expect(files.get('xl/workbook.xml')).toContain('name="A&amp;B"');
  });

  it('recorta el nombre de hoja a 31 caracteres', () => {
    const zip = buildWorkbook([{ name: 'x'.repeat(40), rows: [['a']] }]);
    const workbook = readEntries(zip).get('xl/workbook.xml') ?? '';
    expect(workbook).toContain(`name="${'x'.repeat(31)}"`);
  });

  it('neutraliza fórmulas al construir el libro', () => {
    const zip = buildWorkbook([{ name: 'F', rows: [['=1+1'], ['+A1'], ['-1'], ['@x']] }]);
    const sheet = readEntries(zip).get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain("'=1+1");
    expect(sheet).toContain("'+A1");
    expect(sheet).toContain("'-1");
    expect(sheet).toContain("'@x");
  });

  it('omite celdas nulas', () => {
    const zip = buildWorkbook([{ name: 'N', rows: [[null, 'ok']] }]);
    const sheet = readEntries(zip).get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).not.toContain('r="A1"');
    expect(sheet).toContain('<c r="B1" t="inlineStr">');
  });
});

describe('sanitizeCellText', () => {
  it('neutraliza textos que empiezan por operador de fórmula o control', () => {
    expect(sanitizeCellText('=1+1')).toBe("'=1+1");
    expect(sanitizeCellText('+A1')).toBe("'+A1");
    expect(sanitizeCellText('-1')).toBe("'-1");
    expect(sanitizeCellText('@x')).toBe("'@x");
    expect(sanitizeCellText('\tfoo')).toBe("'\tfoo");
    expect(sanitizeCellText('\rfoo')).toBe("'\rfoo");
  });

  it('deja intacto el texto normal', () => {
    expect(sanitizeCellText('Casco')).toBe('Casco');
    expect(sanitizeCellText('')).toBe('');
    expect(sanitizeCellText('1+1')).toBe('1+1');
  });
});

describe('escapeXml', () => {
  it('escapa los caracteres significativos y deja intacto el apóstrofo', () => {
    expect(escapeXml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
    expect(escapeXml("'Casco'")).toBe("'Casco'");
  });
});
