import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { PASSWORD_ITERATIONS } from '../src/worker/lib/crypto';
import { likePattern } from '../src/worker/lib/sql';
import { listObjectSummaries } from '../src/worker/repositories/content';
import { ApiClient } from './helpers';

/**
 * Límites de la plataforma que el runtime local **no** aplica.
 *
 * Esta suite existe por un fallo real: el proyecto cifraba las contraseñas con
 * 210 000 iteraciones de PBKDF2, las 176 pruebas pasaban en local y el primer
 * despliegue de verdad falló al crear el administrador, porque Cloudflare
 * rechaza cualquier cifra por encima de 100 000. Miniflare usa el mismo
 * `workerd`, pero sin los topes de producción.
 *
 * Como no se pueden provocar aquí los rechazos reales, lo que se fija es el
 * **contrato**: los valores del código deben caber en los límites documentados.
 * Las cifras salen de la documentación de Cloudflare (Workers y D1).
 */

/** `Pbkdf2 failed: iteration counts above 100000 are not supported`. */
const PBKDF2_ITERATIONS_MAX = 100_000;
/** D1: máximo de caracteres (bytes) en un patrón `LIKE` o `GLOB`. */
const LIKE_PATTERN_MAX_BYTES = 50;
/** D1: máximo de parámetros por consulta. */
const BOUND_PARAMS_MAX = 100;

describe('límites de la plataforma', () => {
  it('cifra las contraseñas dentro del tope de PBKDF2 de Cloudflare', () => {
    expect(PASSWORD_ITERATIONS).toBeGreaterThan(0);
    expect(PASSWORD_ITERATIONS).toBeLessThanOrEqual(PBKDF2_ITERATIONS_MAX);
  });

  it('acota el patrón LIKE a los bytes que admite D1', () => {
    const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

    // Lo normal no se toca.
    expect(likePattern('casco')).toBe('%casco%');
    expect(likePattern('50%')).toBe('%50\\%%');

    // Un término largo se recorta hasta caber.
    expect(bytes(likePattern('a'.repeat(200)))).toBeLessThanOrEqual(LIKE_PATTERN_MAX_BYTES);

    // Con acentos (2 bytes por carácter) tampoco se pasa, y no parte ninguno.
    const accented = likePattern('ñ'.repeat(100));
    expect(bytes(accented)).toBeLessThanOrEqual(LIKE_PATTERN_MAX_BYTES);
    expect(accented).not.toContain('\uFFFD');

    // Comodines: sigue escapándolos aunque se recorte.
    expect(bytes(likePattern('%'.repeat(100)))).toBeLessThanOrEqual(LIKE_PATTERN_MAX_BYTES);
    expect(likePattern('%'.repeat(100))).not.toContain('%%%');

    // Al recortar no puede quedar una barra de escape suelta al final: SQLite
    // rechazaría el patrón.
    expect(likePattern(`${'a'.repeat(47)}\\`)).toBe(`%${'a'.repeat(47)}%`);
  });

  it('consulta en tandas cuando hay más identificadores que parámetros admite D1', async () => {
    const total = BOUND_PARAMS_MAX * 3;
    const statements = [];
    for (let index = 0; index < total; index += 1) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO storage_objects (object_key, content_type, byte_size, is_public, scope, created_at)
           VALUES (?, 'image/png', 10, 0, 'site', ?)`,
        ).bind(`objects/prueba-${index}.png`, new Date().toISOString()),
      );
    }
    await env.DB.batch(statements);

    const inserted = await env.DB.prepare(`SELECT id FROM storage_objects ORDER BY id`).all<{
      id: number;
    }>();
    const ids = inserted.results.map((row) => row.id);
    expect(ids).toHaveLength(total);

    // Con la consulta sin trocear serían 300 parámetros: más de los 100 que
    // admite D1 en producción.
    const rows = await listObjectSummaries(env.DB, ids);
    expect(rows).toHaveLength(total);
  });

  it('responde a una búsqueda larga sin error de SQL', async () => {
    const api = new ApiClient();
    await api.setupAdmin();
    await api.post('/api/v1/persons', { fullName: 'Integrante de Prueba', rut: '11.111.111-1' });

    // 120 caracteres es el máximo que admiten los dos extremos. Sin el recorte
    // del patrón, el `LIKE` resultante pasaría de los 50 bytes que admite D1.
    const longSearch = encodeURIComponent('a'.repeat(120));
    expect((await api.get(`/api/v1/persons?q=${longSearch}`)).status).toBe(200);
    expect((await api.get(`/api/v1/inventory/materials?q=${longSearch}`)).status).toBe(200);

    // Por encima de ese máximo, materiales lo rechaza en la validación (400) y
    // la ruta de personas lo recorta antes de construir la consulta.
    const tooLong = encodeURIComponent('a'.repeat(300));
    expect((await api.get(`/api/v1/inventory/materials?q=${tooLong}`)).status).toBe(400);
    expect((await api.get(`/api/v1/persons?q=${tooLong}`)).status).toBe(200);
  });
});
