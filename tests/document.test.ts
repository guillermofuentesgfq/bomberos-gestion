import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * El documento de la SPA lo sirve el Worker (`run_worker_first` incluye `/` e
 * `/index.html`), que lo toma del binding `ASSETS`. Esta prueba comprueba que el
 * binding existe de verdad y que el documento lleva las cabeceras de seguridad:
 * sin el binding declarado en `wrangler.jsonc`, `env.ASSETS` es `undefined` y la
 * portada responde 500.
 */
describe('documento de la aplicación', () => {
  it('sirve la portada con las cabeceras de seguridad', async () => {
    const response = await SELF.fetch('https://bomberos.test/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');

    // Las cabeceras las aplica el Worker: es lo que aporta `frame-ancestors` y
    // la protección de enmarcado que la meta CSP del documento no puede dar.
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')?.toLowerCase()).toBe('sameorigin');
  });

  it('sirve una ruta de cliente como la portada (respaldo de la SPA)', async () => {
    const response = await SELF.fetch('https://bomberos.test/noticias');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});
