import { describe, expect, it } from 'vitest';
import { randomId, randomToken, slugify, toBase64Url } from './ids';

describe('ids', () => {
  it('generateSalt-like: randomId devuelve hex de la longitud pedida', () => {
    expect(randomId(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('randomId no repite valores', () => {
    const set = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(set.size).toBe(50);
  });

  it('randomToken usa base64url sin relleno', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
    expect(token.length).toBeGreaterThan(40);
  });

  it('toBase64Url no usa + ni /', () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 254, 0, 1, 2]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('slugify normaliza acentos, ñ y espacios', () => {
    expect(slugify('Incendio en Ñuñoa')).toBe('incendio-en-nunoa');
    expect(slugify('  Acta de Entrega — N°1  ')).toBe('acta-de-entrega-n-1');
    expect(slugify('Materiales / EPP')).toBe('materiales-epp');
  });
});
