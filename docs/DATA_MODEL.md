# Modelo de datos

La base de datos es **de una sola institución**. No hay columna de tenant ni
aislamiento multitenencia: si una institución administra varias unidades
organizativas, lo hace dentro de su propia instancia.

Migraciones en `migrations/`. Fechas en ISO-8601 UTC. Booleanos como `INTEGER`
0/1. El borrado es **lógico** (`archived_at`), no físico.

## Configuración y seguridad

| Tabla | Propósito |
|---|---|
| `institution_settings` | par clave/valor de la configuración institucional (nombre, colores, contacto, SEO base) |
| `permissions` | catálogo de permisos (`inventory.write`, `site.publish`, …) |
| `roles` | roles de la instalación; los cinco iniciales son del sistema |
| `role_permissions` | qué permisos concede cada rol |
| `users` | cuentas; hash, sal e iteraciones separados; bloqueo por intentos |
| `user_roles` | roles asignados a cada usuario |
| `sessions` | sesiones opacas; se guarda el **hash** del secreto, nunca el token |
| `login_attempts` | intentos de acceso para limitar fuerza bruta |
| `audit_log` | registro de operaciones relevantes, sin secretos |
| `storage_objects` | metadatos de los objetos en R2 (privado por defecto) |
| `idempotency_keys` | claves de idempotencia de operaciones sensibles |

## Catálogos configurables

| Tabla | Propósito |
|---|---|
| `locations` | ubicaciones: salas, bodegas, móviles, taller… |
| `categories` | categorías de material |
| `material_types` | tipos / subcategorías, opcionalmente por categoría |
| `material_conditions` | condiciones físicas; `is_available` marca lo entregable |
| `position_types` | denominaciones de cargo configurables, sin jerarquía fija |
| `qualities` | calidades de integrante (Activo, Abanderado, Aspirante, …) |

## Inventario

| Tabla | Propósito |
|---|---|
| `materials` | el **concepto** ("Casco estructural"); no una unidad física |
| `lots` | conjunto de unidades creadas juntas (una compra) |
| `material_units` | **unidad física** con código, serie y talla (opcional por material) |
| `stock_levels` | cantidad de un material en una ubicación con una condición; **única fuente de verdad** de "cuánto hay dónde" |
| `movements` | bitácora tipada de todo movimiento |

La separación `materials` / `material_units` / `stock_levels` corrige el defecto
del sistema original, donde materiales y unidades físicas compartían una única
tabla. `is_individual` indica si un material se identifica por unidad.

## Personas

| Tabla | Propósito |
|---|---|
| `persons` | ficha de la persona (contacto, emergencia, reseña, foto) |
| `person_positions` | historial de cargos, con cargo de catálogo o etiqueta libre |

## Asignaciones y devoluciones

| Tabla | Propósito |
|---|---|
| `assignments` | cabecera de una entrega (`batch_id` agrupa la entrega multi-línea) |
| `assignment_lines` | línea entregada; `returned_qty <= quantity` por `CHECK` |
| `returns` | cabecera de una devolución |
| `return_lines` | líneas devueltas, con condición de entrada; soporta devoluciones **parciales** |

## Movimientos de material

| Tabla | Propósito |
|---|---|
| `transfers` | traslados entre ubicaciones (`from <> to` por `CHECK`) |
| `writeoffs` | bajas, con motivo y responsable obligatorios |
| `maintenance_records` | mantenciones y revisiones, con condición resultante |

## Sitio público (CMS)

| Tabla | Propósito |
|---|---|
| `site_sections` | secciones de la landing: activables, desactivables y ordenables |
| `pages` | páginas estáticas con estado borrador/publicado/archivado |
| `news` | noticias y comunicados |
| `activities` | actividades y eventos |
| `galleries` / `gallery_photos` | álbumes y sus fotos |
| `seo_settings` | metadatos SEO globales (sitemap, Open Graph, robots) |

## Invariantes garantizados por el esquema

- `stock_levels.quantity >= 0`.
- `material_units.serial` único cuando no está vacío (índice parcial).
- `assignment_lines.returned_qty <= quantity`.
- `return_lines.quantity > 0` y referencian una línea de asignación concreta.
- `transfers.from_location_id <> to_location_id`.
- Claves foráneas con `ON DELETE RESTRICT` donde un borrado rompería trazabilidad.

Estas restricciones son la última línea de defensa; la lógica de negocio las
refuerza con `UPDATE` condicionales y transacciones `batch()`.
