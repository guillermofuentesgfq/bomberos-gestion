# Arquitectura

## Visión general

Un único **Cloudflare Worker** atiende la API y sirve la aplicación web. D1,
R2 y KV son los servicios de datos. Cada institución despliega su propia
instalación en su propia cuenta: el código es compartido, la infraestructura y
los datos no.

```
Usuario
   │
   ▼
Cloudflare (mismo origen, sin CORS)
   │
   ├─ Static Assets ──────► SPA React compilada (dist/web)
   │                        (peticiones a assets: gratis e ilimitadas)
   │
   └─ /api/*  ───────────► Worker (Hono + Zod, TypeScript estricto)
                              ├─ routes/        HTTP + validación Zod
                              ├─ security/      sesiones, permisos, CSRF, auditoría
                              ├─ services/      reglas de negocio e integridad
                              └─ repositories/  SQL parametrizado (D1)
                                     │
                                     ├─ D1  (datos)
                                     ├─ R2  (archivos, privado)
                                     └─ KV  (caché no crítica, opcional)
```

## Capas y responsabilidades

- **`src/worker/routes/`** — define endpoints, valida la entrada con Zod y
  traduce a/desde los servicios. No contiene reglas de negocio.
- **`src/worker/security/`** — autenticación, sesiones, autorización por
  permiso, CSRF, limitación de intentos y auditoría.
- **`src/worker/services/`** — reglas de negocio y **garantías de integridad**.
  Es el único lugar que mueve existencias.
- **`src/worker/repositories/`** — acceso a D1. SQL siempre parametrizado.
- **`src/worker/lib/`** — utilidades transversales (errores, respuestas, env).
- **`src/web/`** — SPA React + Vite + Tailwind servida como Static Assets.
- **`src/shared/`** — tipos compartidos entre Worker y SPA.

## Decisiones clave

### Mismo origen

El Worker sirve la API y los assets desde el mismo origen. Esto elimina CORS,
simplifica las cookies de sesión y permite una CSP estricta. La SPA llama a
`/api/v1/...` relativo.

### Integridad de inventario bajo las restricciones de D1

D1 no ofrece transacciones interactivas entre peticiones: no se puede leer,
decidir en el código y escribir de forma atómica. Las garantías se construyen
así:

1. **Guardas por restricción de esquema.** Restar existencias es un `UPDATE`
   que **no** comprueba el saldo en SQL, sino que confía en la restricción
   `CHECK (quantity >= 0)`:
   ```sql
   INSERT OR IGNORE INTO stock_levels
     (material_id, location_id, condition_code, quantity, updated_at)
     VALUES (?, ?, ?, 0, ?);          -- asegura que la fila existe

   UPDATE stock_levels
      SET quantity = quantity - ?, updated_at = ?
    WHERE material_id = ? AND location_id = ? AND condition_code = ?;
   ```
   Si la resta dejaría un saldo negativo, la restricción `CHECK` rechaza la
   sentencia y **toda la transacción se revierte**. La capa de servicio
   traduce esa violación a un error de negocio («No hay existencias
   suficientes»). El mismo patrón protege las devoluciones parciales mediante
   `CHECK (returned_qty <= quantity)` en `assignment_lines`.
2. **`db.batch()`.** Las escrituras de una operación (existencias, asignación,
   movimiento) van en un solo batch, que es transaccional: si una sentencia
   falla, se revierte el conjunto. La **fila de auditoría se escribe aparte**,
   después del lote y como sentencia tolerante a fallos (ver más abajo): no
   forma parte de la transacción y una operación ya confirmada puede quedarse
   sin su fila de auditoría si esa escritura falla.
3. **Restricciones de esquema.** Claves foráneas, `CHECK (quantity >= 0)`,
   `UNIQUE` en series y claves de idempotencia. Como el `CHECK` solo se evalúa
   sobre la fila que el `UPDATE` toca, **toda resta de existencias asegura antes
   la fila origen** dentro del mismo lote: sin ella, el descuento no afectaría
   ninguna fila y el lote confirmaría una operación que no descontó nada.
4. **Idempotencia.** Las operaciones sensibles aceptan una `Idempotency-Key`
   ligada al titular que la usa: un reintento del mismo titular devuelve la
   respuesta original, la clave de otro titular se rechaza, y una operación que
   falla libera la reserva para poder reintentarse.
5. **Serialización.** Cada base D1 es mono-hilo, de modo que las escrituras se
   ejecutan una a una.

> **La auditoría es tolerante a fallos, a propósito.** Se registra después de
> confirmar la operación de negocio y un error al escribirla no tumba la
> operación (solo deja un aviso en el log del Worker). Es el compromiso elegido
> para no perder una baja o una entrega por un fallo del registro; implica que,
> si esa escritura falla, la operación queda sin su fila de auditoría. Todas las
> mutaciones relevantes de usuarios, personal, contenido, archivos, inventario e
> informes escriben su fila.

> **Limpieza periódica.** El Worker exporta un manejador `scheduled` que un cron
> diario (`triggers.crons` en `wrangler.jsonc`) usa para borrar sesiones
> caducadas o revocadas de más de 30 días, intentos de ingreso de más de 30 días
> y reservas de idempotencia caducadas. El registro de auditoría **no** se
> purga: es el rastro forense y su retención la decide el operador. El almacén de
> archivos tiene además un tope agregado (`MAX_TOTAL_STORAGE_BYTES`, 1 GiB por
> defecto en `services/storage.ts`): los topes por archivo no acotan el total.

### Archivos privados

R2 no se expone nunca de forma pública (nada de `r2.dev`). Las descargas pasan
por el Worker, que comprueba sesión y permiso. Solo los objetos marcados
explícitamente como públicos (`storage_objects.is_public = 1`) se sirven sin
autenticación, y solo para el sitio institucional.

La **foto de una persona** es un dato personal y siempre es privada; la foto de
un material, también. Se sirven con sesión, nunca desde el sitio público.

**El acceso es por objeto, según su ámbito.** Cada objeto lleva su `scope`
(`site`, `inventory` o `person`): descargar una foto privada exige el permiso de
lectura de ese ámbito (`persons.read` para la de una persona, `inventory.read`
para la de un material, `site.read` para las del sitio) y archivarla, el de
escritura. Publicar (`is_public = 1`) exige autoridad del sitio y solo está
previsto para imágenes institucionales: un objeto de inventario o de una persona
es privado por construcción. Las referencias también se validan al escribir, de
modo que una ficha de persona no puede enlazar la foto de otro apartado.

### Texto enriquecido y XSS

El contenido del sitio (cuerpos y resúmenes de páginas, noticias, actividades y
descripciones de galerías) se escribe con un editor visual y se guarda como
HTML. Ese HTML se inserta después en el documento del sitio público, así que es
un vector de XSS almacenado.

La defensa es una **lista blanca aplicada en el servidor, al guardar**
(`src/worker/lib/richtext.ts`): se aceptan solo unas pocas etiquetas de
formato, el único atributo permitido es `href` en `a` y solo con esquemas
seguros. Todo lo demás se descarta; el texto siempre se conserva escapado. El
saneado **no** ocurre en el cliente: un editor comprometido no puede saltárselo,
porque lo que llega a la base ya está limpio y es lo que sirve la API pública.
Se complementa con la política de seguridad de contenido del Worker.

### Identidad visual: icono y foto de portada

El **icono de la pestaña** (`/favicon.ico` y `/apple-touch-icon.png`) lo sirve
el Worker a partir del escudo configurado, y si no hay escudo, del logotipo. No
hay un archivo fijo en el repositorio: así cada instalación lleva su propia
identidad sin tocar el código. Solo se sirve si el objeto es **público**, porque
lo pide el navegador sin sesión.

Consecuencia de despliegue: los assets estáticos tienen prioridad sobre el
Worker, de modo que estas rutas **deben** estar en `assets.run_worker_first` de
`wrangler.jsonc` (junto a `/api/*`, `/sitemap.xml` y `/robots.txt`). Si se
quitan de ahí, el navegador recibirá el `index.html` de la SPA en vez del icono.

La **foto de portada** (`coverObjectId`) es otro objeto **público**: se muestra
como fondo de la portada del sitio. Como el escudo y el logotipo, se resuelve a
través de `storage_objects` y solo se expone si está marcada como pública.

### Límites del plan gratuito

El diseño respeta las cuotas gratuitas (verificadas en octubre de 2026):

- **Workers:** 100 000 peticiones/día, 10 ms de CPU por invocación, 50
  subpeticiones. Las peticiones a assets estáticos son gratis e ilimitadas.
- **D1:** 5 M de filas leídas/día, 100 000 filas escritas/día, 5 GB total y
  **500 MB por base**. Desde septiembre de 2026 los excesos **fallan** hasta las
  00:00 UTC. Por eso los archivos van a R2, no a D1.
- **R2:** 10 GB-mes de almacenamiento, 1 M de operaciones clase A y 10 M clase B
  al mes, con egreso gratuito.

Consecuencias: agrupar consultas con `batch`, indexar las columnas filtradas y
evitar `SELECT *` (cuenta filas escaneadas).

## Entornos

| Entorno | API | SPA |
|---|---|---|
| Desarrollo | `wrangler dev` en `127.0.0.1:8787`, D1 local | Vite en `:5173` con proxy a `/api` |
| Producción | Worker desplegado | assets servidos por el mismo Worker |

Las migraciones se aplican con `wrangler d1 migrations apply` (`--local` o
`--remote`).
