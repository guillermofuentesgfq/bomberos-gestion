import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  constantTimeEqualHex,
  derivePasswordHash,
  generateSaltHex,
  hmacSha256Hex,
  sha256Hex,
} from './crypto';

describe('crypto', () => {
  it('calcula el SHA-256 del vector conocido "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('genera sales hexadecimales de 32 caracteres', () => {
    const salt = generateSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSaltHex()).not.toBe(salt);
  });

  it('compara en tiempo constante cadenas y hex', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualHex('deadbeef', 'deadbeef')).toBe(true);
    expect(constantTimeEqualHex('deadbeef', 'deadbeee')).toBe(false);
  });

  it('deriva el mismo hash con la misma sal y pepper', async () => {
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const a = await derivePasswordHash('secreta', salt, 'pepper-uno', 1000);
    const b = await derivePasswordHash('secreta', salt, 'pepper-uno', 1000);
    expect(a).toBe(b);
  });

  it('cambia el hash si cambia la sal, el pepper o la contraseña', async () => {
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const base = await derivePasswordHash('secreta', salt, 'pepper-uno', 1000);
    expect(await derivePasswordHash('secreta', salt, 'pepper-dos', 1000)).not.toBe(base);
    expect(
      await derivePasswordHash('secreta', 'ffffffffffffffffffffffffffffffff', 'pepper-uno', 1000),
    ).not.toBe(base);
    expect(await derivePasswordHash('otra', salt, 'pepper-uno', 1000)).not.toBe(base);
  });

  it('produce un HMAC estable', async () => {
    const a = await hmacSha256Hex('clave', 'mensaje');
    const b = await hmacSha256Hex('clave', 'mensaje');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacSha256Hex('otra-clave', 'mensaje')).not.toBe(a);
  });
});
