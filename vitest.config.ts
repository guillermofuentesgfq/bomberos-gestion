import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

/**
 * Las pruebas se ejecutan dentro del runtime de Workers (workerd) con Miniflare,
 * de modo que usan bindings reales de D1 y R2. Las migraciones versionadas se
 * aplican a una base de datos aislada por archivo de prueba.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Valores SOLO para pruebas. No son secretos reales.
            APP_ENV: 'development',
            AUTH_PASSWORD_PEPPER: 'pepper-solo-para-pruebas-0123456789abcdef',
            AUTH_SESSION_SECRET: 'sesion-solo-para-pruebas-0123456789abcdef',
            BOOTSTRAP_TOKEN: 'token-de-pruebas',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      exclude: ['node_modules', 'dist', '.wrangler'],
      setupFiles: ['./tests/setup.ts'],
      passWithNoTests: true,
      testTimeout: 20000,
    },
  };
});
