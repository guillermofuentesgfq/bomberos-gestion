# Auditoría del sistema original y matriz de paridad

Este documento resume el análisis del sistema Flask/SQLite entregado como ZIP
(`Sistema_2da_Compania_V2_7_ELIMINAR_CARGOS.zip`) y cómo cada función se
conserva o se mejora en esta reescritura. Corresponde a la **Fase A**.

No se copió al repositorio ningún dato personal, credencial, secreto ni imagen
institucional del proyecto original.

## 1. Descripción del sistema original

- **Stack:** Flask + SQLite, empaquetado para Windows con un script `INICIAR_SISTEMA.bat`
  que crea un entorno virtual e instala `Flask` y `openpyxl`.
- **Tamaño:** un único `app.py` de 574 líneas (~50 KB) con rutas, acceso a datos,
  reglas de negocio y seguridad mezcladas; 11 plantillas Jinja2; un `style.css`;
  un logotipo institucional real.
- **Persistencia:** `inventario.db` (creado con `CREATE TABLE IF NOT EXISTS` y
  `ALTER TABLE` oportunista como pseudo-migraciones), fotos en
  `static/uploads/inventario/`, clave de sesión en `.session_key` y respaldos en
  `respaldos/`.

## 2. Entidades del original

| Tabla original | Contenido |
|---|---|
| `settings` | par clave/valor; solo `password_hash` |
| `options` | catálogos: `location`, `category`, `subtype` |
| `items` | **materiales y unidades físicas en la misma tabla** (auto-referencia por `unit_group`) |
| `item_photos` | fotos por material (ficheros en disco) |
| `movements` | bitácora de movimientos |
| `personnel` | personas, con campos añadidos por `ALTER TABLE` |
| `positions` | historial de cargos |
| `assignments` | entregas, con `batch_id`, `condition_out/in`, `size`, `serial` |
| `writeoffs` | bajas con motivo y acta |

## 3. Matriz de paridad

| Función original | Estado | Nota |
|---|---|---|
| Login con contraseña única | **Reemplazado** | pasa a usuarios + roles + sesiones revocables |
| Dashboard (stats, estados, ubicaciones, últimos movimientos) | Conservado y ampliado | se añaden stock mínimo, devoluciones pendientes y actividad administrativa |
| Inventario general con resumen por tipo y filtros | Conservado | |
| CRUD de material con varias fotos y captura desde cámara | Conservado | las fotos pasan a R2 privado |
| Lotes de 2–200 unidades con series | Conservado | |
| Unidades individuales (identificar / ingresar) talla y serie | Conservado | modelo separado material / unidad |
| Cambio de condición por unidades | Conservado | |
| Traslados totales y parciales | Conservado | |
| Historial de movimientos | Conservado y tipado | |
| Vista por ubicación | Conservado | |
| Personal con ficha completa y reseña | Conservado | |
| Historial de cargos (alta / borrado) | Conservado | borrado pasa a archivado lógico |
| Entregas multi-línea con verificación de stock | Conservado | verificación atómica en servidor |
| Catastro de material ya asignado | Conservado | |
| Devoluciones | Ampliado | se añaden devoluciones **parciales** |
| Actas imprimibles de entrega y baja | Conservado | |
| Bajas con motivo obligatorio | Conservado | |
| Mantenimiento (plantilla huérfana, sin ruta) | **Implementado** | pasa a módulo real |
| Respaldos (copia del `.db`) | Sustituido | D1 Time Travel + export/restore documentado |
| Exportación Excel de 5 hojas | Conservado | con protección anti-inyección de fórmulas |
| Ajustes de catálogos y contraseña | Ampliado | pasa a configuración institucional completa |
| Nómina real sembrada en código | **Eliminado** | instalación vacía; sin datos personales |
| Logotipo institucional real | **Eliminado** | logo configurable por la institución |

## 4. Defectos identificados y su corrección

### Seguridad

| Defecto | Corrección |
|---|---|
| Contraseña única compartida, con valor por defecto conocido | usuarios, roles y sesiones; sin contraseñas por defecto; inicialización segura del primer administrador |
| CSRF casi inexistente (solo 3 formularios con token) | protección CSRF en toda operación con estado |
| Sin autorización ni roles | permisos verificados en el servidor en cada endpoint |
| Fotos servidas públicamente bajo `/static` | R2 privado; descarga con autorización; publicación explícita |
| Validación de imágenes solo por extensión | validación real de contenido, dimensiones, tamaño y formato |
| Cookies sin `Secure`, sesión sin expiración | cookies `HttpOnly; Secure; SameSite`, sesiones con caducidad y revocación |
| Sin cabeceras de seguridad ni CSP | CSP y cabeceras de seguridad por defecto |
| Sin límite de intentos (fuerza bruta) | limitación de intentos y bloqueo temporal |
| Sin auditoría | registro de auditoría de operaciones relevantes |

### Integridad de inventario

| Defecto | Corrección |
|---|---|
| Operaciones multipaso sin transacción | escrituras agrupadas en `db.batch()` atómico |
| Condiciones de carrera (TOCTOU) en cantidades | `UPDATE` condicionales (`WHERE quantity >= ?`) como guarda atómica |
| Devolución parcial mal modelada (crea filas ad-hoc) | modelo `assignments` / `assignment_lines` / `returns` / `return_lines` |
| Sin idempotencia | `Idempotency-Key` persistida por operación sensible |
| Borrado físico de materiales y cargos | archivado lógico (`archived_at`) |

### Mantenibilidad

| Defecto | Corrección |
|---|---|
| Toda la lógica en `app.py` | capas `routes` / `services` / `repositories` / `security` |
| Migraciones oportunistas (`ensure_column`) | migraciones versionadas |
| `templates/maintenance.html` huérfano | módulo de mantenimiento funcional |
| Datos personales reales incrustados en el código | instalación vacía; datos de demostración opcionales y marcados |
| Todo hardcodeado a una compañía concreta | configuración institucional sin tocar código |

## 5. Restricción técnica relevante

D1 **no ofrece transacciones interactivas** entre peticiones. La integridad se
garantiza con guardas atómicas (`UPDATE ... WHERE quantity >= ?`), transacciones
`batch()` y claves de idempotencia. Ver [`ARCHITECTURE.md`](ARCHITECTURE.md).
