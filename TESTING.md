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
Test Files  14 passed (14)
     Tests  174 passed (174)
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
| `tests/inventory.test.ts` | integridad de existencias, entregas, devoluciones parciales, idempotencia, concurrencia, inyección SQL, **edición de materiales, foto privada, catálogo y actas imprimibles de entrega y baja** |
| `tests/files.test.ts` | privacidad de archivos y rechazo de contenido activo |
| `tests/content.test.ts` | sitio público, CMS (borrador/publicar/retirar), SEO (sitemap y robots), informes `.xlsx`, imágenes públicas/privadas y **saneado del texto enriquecido de extremo a extremo (contenido y textos institucionales)** |
| `tests/maintenance.test.ts` | limpieza programada (sesiones, intentos de ingreso y reservas de idempotencia caducadas) y acotado del `user-agent` |
| `tests/users.test.ts` | alta, edición, roles, contraseña temporal, desbloqueo y archivado de usuarios; **protecciones para no quedarse sin administrador** y control de permisos |

## Cobertura de los casos exigidos

| Caso | Estado |
|---|---|
| Acceso no autorizado a endpoints | ✅ cubierto (`401`) |
| Operación sin permiso (modificación de roles/permisos) | ✅ cubierto (`403` con rol `viewer`) |
| CSRF | ✅ cubierto (`403` sin cabecera, `201` con ella) |
| XSS | ✅ cubierto: se rechaza contenido activo en archivos (SVG) y todo el HTML enriquecido (cuerpo y resumen de contenido, textos institucionales de la portada y notas de las personas) se sanea en el servidor con lista blanca al guardar — probado de extremo a extremo, incluido el `<script>` que desaparece y el `href="javascript:"` que se neutraliza |
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
| Edición del catálogo | ✅ cubierto (renombrar ubicaciones con su descripción, categorías y tipos —asociando la categoría—, `409` con nombre repetido y `404` si la entrada no existe) |
| Catálogo de personas | ✅ cubierto (crear, editar, duplicar y archivar cargos y calidades, con `409` y `404`) |
| Ficha imprimible del integrante | ✅ cubierto (datos, calidad, cargos con el nombre del cargo resuelto, material pendiente con su condición, notas saneadas y membrete institucional; `404` si la persona no existe) |
| Foto del personal | ✅ cubierto (se sube como objeto privado y aparece en el detalle y en la ficha; `null` la quita) |
| Gestión de usuarios | ✅ cubierto (alta con contraseña temporal, listado con roles y sus permisos, cambio de roles y estado, desbloqueo y archivado; restablecer la contraseña **cierra las sesiones** y vuelve a exigir el cambio) |
| Protección contra el bloqueo total | ✅ cubierto (no se puede desactivar ni quitar el rol de administrador a la propia cuenta, ni dejar la instalación sin ningún administrador activo) |
| Ámbitos de archivos | ✅ cubierto (el permiso de lectura/escritura depende del ámbito del objeto: un editor del sitio no ve ni retira fotos de personal o de material; publicar exige autoridad del sitio; no se puede enlazar en una ficha una foto de otro apartado) |
| Integridad de existencias | ✅ cubierto (no se acuñan existencias ni se registran bajas sin descontar cuando la fila de origen no existe: la operación se rechaza y no deja estado parcial) |
| Idempotencia | ✅ cubierto (una operación fallida libera la clave para poder reintentarse; la respuesta de una clave no se re-entrega a otro titular) |
| Auditoría de personal y catálogo | ✅ cubierto (cada mutación de personal y de sus catálogos deja su fila en `audit_log`) |
| Límites | ✅ cubierto (tope de cuerpo medido con `content-type` estricto, tope de fotos por galería, cuota agregada del almacén, acotado del `user-agent` y limpieza programada de datos caducados) |
| Endurecimiento del ingreso | ✅ cubierto (rechazo de login desde otro origen, respuestas indistinguibles para cuentas inexistentes/desactivadas/bloqueadas, límite al adivinar el token de inicialización y respaldo de IP solo en desarrollo) |
| Actas imprimibles | ✅ cubierto (el acta de entrega documenta la entrega **completa** aunque haya devoluciones parciales, con el membrete de la institución; la de baja lleva motivo, quién autoriza y la condición anterior; `404` si no existe) |
| Icono del sitio | ✅ cubierto (se sirve desde el escudo configurado, `404` si no hay ninguno y `404` si el escudo es privado) |
| Foto de portada | ✅ cubierto (se publica solo si el objeto es público; una portada privada no se expone) |
| Informe imprimible del inventario | ✅ cubierto (totales por material, disponible y no disponible, bajo mínimo y desglose por ubicación y condición) |
| Panel de resumen | ✅ cubierto (contadores reales de materiales y unidades) |

## Nota

No se afirma que una prueba pase si no se ha ejecutado. Los resultados de arriba
provienen de la ejecución real de `npx vitest run` en el entorno de desarrollo.
