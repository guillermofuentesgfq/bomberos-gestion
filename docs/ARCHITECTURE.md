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

1. **Guardas atómicas.** Restar existencias siempre es un `UPDATE` condicional
   comprobado por filas afectadas:
   ```sql
   UPDATE stock_levels
      SET quantity = quantity - ?, updated_at = ?
    WHERE material_id = ? AND location_id = ? AND condition_code = ?
      AND quantity >= ?;
   ```
   Si `meta.changes !== 1`, no había stock suficiente y la operación se aborta.
2. **`db.batch()`.** Todas las escrituras de una operación (existencias,
   asignación, movimiento, auditoría) van en un solo batch, que es transaccional:
   si una sentencia falla, se revierte el conjunto.
3. **Restricciones de esquema.** Claves foráneas, `CHECK (quantity >= 0)`,
   `UNIQUE` en series y claves de idempotencia.
4. **Idempotencia.** Las operaciones sensibles aceptan una `Idempotency-Key`
   que se registra; un reintento devuelve la respuesta original en lugar de
   duplicar el efecto.
5. **Serialización.** Cada base D1 es mono-hilo, de modo que las escrituras se
   ejecutan una a una.

### Archivos privados

R2 no se expone nunca de forma pública (nada de `r2.dev`). Las descargas pasan
por el Worker, que comprueba sesión y permiso. Solo los objetos marcados
explícitamente como públicos (`storage_objects.is_public = 1`) se sirven sin
autenticación, y solo para el sitio institucional.

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
