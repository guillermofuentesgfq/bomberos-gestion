import { describe, expect, it } from 'vitest';
import { derivePasswordHash } from '../lib/crypto';
import { MIN_PASSWORD_LENGTH, hashPassword, isPasswordAcceptable, verifyPassword } from './passwords';
import type { StoredPassword } from './passwords';

const PEPPER = 'pepper-de-prueba-suficientemente-largo';

function toStored(hash: string, salt: string, iterations: number): StoredPassword {
  return {
    password_hash: hash,
    password_salt: salt,
    password_iterations: iterations,
    password_algo: 'PBKDF2-SHA256+HMAC',
  };
}

describe('passwords', () => {
  it('valida la longitud mínima', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(isPasswordAcceptable('corta')).toBe(false);
    expect(isPasswordAcceptable('a'.repeat(12))).toBe(true);
  });

  it('hashea y verifica con el pepper correcto', async () => {
    const hashed = await hashPassword('contrasena-larga-123', PEPPER);
    const stored = toStored(hashed.hash, hashed.salt, hashed.iterations);
    expect(await verifyPassword('contrasena-larga-123', stored, PEPPER)).toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hashed = await hashPassword('contrasena-larga-123', PEPPER);
    const stored = toStored(hashed.hash, hashed.salt, hashed.iterations);
    expect(await verifyPassword('contrasena-larga-124', stored, PEPPER)).toBe(false);
  });

  it('rechaza si el pepper no coincide', async () => {
    const hashed = await hashPassword('contrasena-larga-123', PEPPER);
    const stored = toStored(hashed.hash, hashed.salt, hashed.iterations);
    expect(await verifyPassword('contrasena-larga-123', stored, 'otro-pepper')).toBe(false);
  });

  it('rechaza algoritmos desconocidos', async () => {
    const hashed = await hashPassword('contrasena-larga-123', PEPPER);
    const stored = toStored(hashed.hash, hashed.salt, hashed.iterations);
    stored.password_algo = 'MD5';
    expect(await verifyPassword('contrasena-larga-123', stored, PEPPER)).toBe(false);
  });

  it('produce sal aleatoria por hash (misma contraseña, distinto resultado)', async () => {
    const a = await hashPassword('contrasena-larga-123', PEPPER);
    const b = await hashPassword('contrasena-larga-123', PEPPER);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('verifica con iteraciones reducidas (ruta de parámetros)', async () => {
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const hash = await derivePasswordHash('contrasena-larga-123', salt, PEPPER, 1000);
    const stored = toStored(hash, salt, 1000);
    expect(await verifyPassword('contrasena-larga-123', stored, PEPPER)).toBe(true);
  });
});
