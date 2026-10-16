# Pruebas

## Herramientas

- **Vitest** como ejecutor de pruebas.
- **`@cloudflare/vitest-plugin`**: las pruebas se ejecutan **dentro del runtime de
  Workers** (workerd, vía Miniflare), con bindings reales de **D1** y **R2**. No
  se simulan la base de datos ni el almacenamiento.
- **TypeScript estricto** (`npm run typecheck`) como primera barrera.

## Cómo ejecutar

```bash
npm run test          # una vez (requiere haber compilado antes: npm run build)
npm run test:watch    # modo seguimiento
npm run typecheck     # comprobación de tipos
```

Las pruebas aplican las **migraciones versionadas** a una base D1 limpia por
archivo de prueba (`tests/setup.ts`) y vacían las tablas de datos antes de cada
prueba, conservando las tablas de referencia.

## Estado actual (real)

```
Test Files  11 passed (11)
     Tests  91 passed (91)
```

| Archivo | Qué cubre |
|---|---|
| `src/worker/lib/crypto.test.ts` | SHA-256 con vector conocido, HMAC, derivación PBKDF2, comparación en tiempo constante |
| `src/worker/lib/ids.test.ts` | tokens y códigos aleatorios, base64url, `slugify` con acentos y ñ |
| `src/worker/security/passwords.test.ts` | hash/verificación, pepper incorrecto, algoritmo desconocido, sal por hash |
| `src/worker/lib/sql.test.ts` | interpretación de errores de D1/SQLite (UNIQUE, CHECK, FK) |
| `src/worker/lib/image.test.ts` | validación real de imágenes por bytes (PNG/JPEG/WEBP), SVG y contenido no permitido |
| `src/worker/lib/zip.test.ts` | escritor ZIP sin dependencias: firmas, CRC-32, offsets |
| `src/worker/services/xlsx.test.ts` | OOXML válido, escapado XML y **protección anti-inyección de fórmulas** |
| `tests/auth.test.ts` | inicialización, CSRF, sesiones, fuerza bruta, permisos |
| `tests/inventory.test.ts` | integridad de existencias, entregas, devoluciones parciales, idempotencia, concurrencia, inyección SQL |
| `tests/files.test.ts` | privacidad de archivos y rechazo de contenido activo |
| `tests/content.test.ts` | sitio público, CMS (borrador/publicar/retirar), SEO (sitemap y robots) e informes `.xlsx` |

## Cobertura de los casos exigidos

| Caso | Estado |
|---|---|
| Acceso no autorizado a endpoints | ✅ cubierto (`401`) |
| Operación sin permiso (modificación de roles/permisos) | ✅ cubierto (`403` con rol `viewer`) |
| CSRF | ✅ cubierto (`403` sin cabecera, `201` con ella) |
| XSS | 🟡 parcial: se rechaza contenido activo en archivos (SVG). Falta sanear el HTML del CMS |
| Inyección SQL | ✅ cubierto (filtro con carga maliciosa devuelve lista vacía y no altera la base) |
| Fuerza bruta | ✅ cubierto (bloqueo tras 5 fallos) |
| Archivos inválidos | ✅ cubierto (no-imagen y SVG rechazados) |
| Acceso a archivos privados | ✅ cubierto (`404` sin sesión, `200` con permiso) |
| Entregas superiores al stock | ✅ cubierto (`422` y sin efecto parcial) |
| Devoluciones incorrectas | ✅ cubierto (`422` al superar lo pendiente) |
| Traslados sin pérdida ni duplicación | ✅ cubierto, incluida una prueba de **concurrencia** (5 traslados simultáneos sobre 5 unidades → 2 completados, 3 rechazados, sin negativos) |
| Reintentos de operaciones sensibles | ✅ cubierto (idempotencia por `Idempotency-Key`) |
| Migraciones | ✅ cubierto (se aplican en cada archivo de prueba) |
| Restauración de datos | ⬜ procedimiento documentado en `docs/BACKUP_AND_RESTORE.md`; falta prueba automatizada |
| Publicación y retirada de contenido | ✅ cubierto (borrador no visible → publicar visible → despublicar oculto) |
| Exportaciones | ✅ unitario (neutralización de fórmulas en celdas) e integración (`.xlsx` real descargable) |

## Nota

No se afirma que una prueba pase si no se ha ejecutado. Los resultados de arriba
provienen de la ejecución real de `npx vitest run` en el entorno de desarrollo.
