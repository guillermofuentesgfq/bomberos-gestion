# Pruebas

## Herramientas

- **Vitest** como ejecutor de pruebas.
- **`@cloudflare/vitest-plugin`** para ejecutar pruebas unitarias y de
  integración dentro del runtime de Workers, con bindings de D1 y R2 locales.
- TypeScript estricto (`npm run typecheck`) como primera barrera.

## Cómo ejecutar

```bash
npm run test          # una vez
npm run test:watch    # en modo seguimiento
npm run typecheck     # comprobación de tipos
```

## Estrategia por niveles

| Nivel | Qué comprueba |
|---|---|
| Unitaria | servicios de negocio puros (cálculo de cantidades, validaciones Zod, utilidades de hash) |
| Integración | endpoints contra D1/R2 locales: altas, entregas, devoluciones, traslados, bajas |
| Seguridad | acceso no autorizado, permisos, CSRF, XSS, inyección SQL, fuerza bruta, archivos inválidos, acceso a privados |
| Aceptación | recorridos completos: entrega → acta → devolución parcial → inventario |

## Casos exigidos (a implementar en la fase de pruebas)

- Acceso no autorizado a endpoints.
- Modificación de roles sin permiso.
- CSRF en operaciones con estado.
- XSS en contenido del sitio.
- Inyección SQL en filtros y búsquedas.
- Fuerza bruta contra el login.
- Archivos inválidos o con contenido activo.
- Acceso a archivos privados sin autorización.
- Entregas superiores al stock disponible.
- Devoluciones incorrectas o superiores a lo pendiente.
- Traslados concurrentes sin pérdida ni duplicación.
- Reintentos de operaciones sensibles (idempotencia).
- Migraciones aplicadas sobre base existente.
- Restauración de datos.
- Publicación y retirada de contenido.
- Exportaciones con protección anti-inyección de fórmulas.

## Estado actual

**Aún no hay pruebas ejecutadas.** El andamiaje de Vitest está configurado y
`npm run test` no falla cuando no hay pruebas (`passWithNoTests`). Este documento
se actualizará con los resultados reales a medida que se implementen. No se
afirmará que una prueba pasa si no se ha ejecutado.
