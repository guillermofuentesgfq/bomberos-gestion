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
Test Files  12 passed (12)
     Tests  123 passed (123)
```

| Archivo | Qué cubre |
|---|---|
| `src/worker/lib/crypto.test.ts` | SHA-256 con vector conocido, HMAC, derivación PBKDF2, comparación en tiempo constante |
| `src/worker/lib/ids.test.ts` | tokens y códigos aleatorios, base64url, `slugify` con acentos y ñ |
| `src/worker/lib/richtext.test.ts` | saneado de HTML: se quitan `script`/`style`/`iframe` con su contenido, atributos de evento, `javascript:`/`data:`/`vbscript:`; se conserva el formato permitido; se normalizan `b`/`i`; se cierran etiquetas abiertas; no se vuelven a escapar las entidades; texto suelto con `<` y `>` |
| `src/worker/security/passwords.test.ts` | hash/verificación, pepper incorrecto, algoritmo desconocido, sal por hash |
| `src/worker/lib/sql.test.ts` | interpretación de errores de D1/SQLite (UNIQUE, CHECK, FK) |
| `src/worker/lib/image.test.ts` | validación real de imágenes por bytes (PNG/JPEG/WEBP), SVG y contenido no permitido |
| `src/worker/lib/zip.test.ts` | escritor ZIP sin dependencias: firmas, CRC-32, offsets |
| `src/worker/services/xlsx.test.ts` | OOXML válido, escapado XML y **protección anti-inyección de fórmulas** |
| `tests/auth.test.ts` | inicialización, CSRF, sesiones, fuerza bruta, permisos |
| `tests/inventory.test.ts` | integridad de existencias, entregas, devoluciones parciales, idempotencia, concurrencia, inyección SQL, **edición de materiales, foto privada y catálogo** |
| `tests/files.test.ts` | privacidad de archivos y rechazo de contenido activo |
| `tests/content.test.ts` | sitio público, CMS (borrador/publicar/retirar), SEO (sitemap y robots), informes `.xlsx`, imágenes públicas/privadas y **saneado del texto enriquecido de extremo a extremo** |

## Cobertura de los casos exigidos

| Caso | Estado |
|---|---|
| Acceso no autorizado a endpoints | ✅ cubierto (`401`) |
| Operación sin permiso (modificación de roles/permisos) | ✅ cubierto (`403` con rol `viewer`) |
| CSRF | ✅ cubierto (`403` sin cabecera, `201` con ella) |
| XSS | ✅ cubierto: se rechaza contenido activo en archivos (SVG) y el HTML del CMS se sanea en el servidor con lista blanca al guardar (probado de extremo a extremo, incluido el `<script>` que desaparece y el `href="javascript:"` que se neutraliza) |
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
| Edición de inventario | ✅ cubierto (cambio parcial que conserva los campos no enviados, código duplicado → `409`, y `403` sin permiso de escritura) |
| Foto de material | ✅ cubierto (se asigna, aparece en listado y detalle, y se quita con `null`) |
| Catálogo de inventario | ✅ cubierto (alta de tipos y archivado de ubicaciones: la fila se conserva) |

## Nota

No se afirma que una prueba pase si no se ha ejecutado. Los resultados de arriba
provienen de la ejecución real de `npx vitest run` en el entorno de desarrollo.
