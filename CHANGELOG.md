# Historial de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [Versionado Semántico](https://semver.org/lang/es/). El
procedimiento para publicar una versión está en
[`docs/RELEASING.md`](docs/RELEASING.md).

## [No publicado]

## [0.1.1] - 2026-10-16

### Corregido

- **Dominio propio, documentado y declarable.** La guía de despliegue explicaba
  el dominio solo por el panel. Ahora documenta el requisito que más fallos
  causa —el dominio tiene que estar dado de alta como zona **en la misma cuenta
  de Cloudflare**, o el despliegue se rechaza con *«Couldn't find a zone named …
  in this account»*— y la forma declarada, que crea el registro y el certificado
  desde el propio despliegue:

  ```jsonc
  "routes": [{ "pattern": "tu-dominio.cl", "custom_domain": true }]
  ```

- La plantilla de institución (`deploy/wrangler-instancia.example.jsonc`) incluye
  ese bloque y el cierre de la dirección `workers.dev` cuando el dominio ya
  funciona, ambos comentados para que la plantilla despliegue tal cual.
- **Los marcadores de la plantilla estaban en mayúsculas** (`MI-INSTITUCION`,
  `MI-BUCKET-R2`) y Wrangler los rechaza: exige nombres en minúsculas con guiones.
  Ahora la plantilla valida tal cual, comprobado con
  `wrangler deploy --dry-run`.

### Notas

- Se documenta que **el Worker no necesita saber el dominio**: el `sitemap.xml`,
  el `robots.txt` y las direcciones absolutas se construyen con el anfitrión de
  cada visita, así que el mismo despliegue responde igual en `workers.dev` y en
  el dominio propio. El campo `siteUrl` de los ajustes de SEO existe para un uso
  futuro y hoy no se consume.

## [0.1.0] - 2026-10-16

Primera versión publicada. Instalación **vacía**: sin datos personales ni
imágenes del sistema anterior. La importación del sistema previo (SQLite) queda
para una versión posterior.

### Añadido

- Auditoría del sistema original y matriz de paridad (`docs/AUDIT.md`),
  arquitectura (`docs/ARCHITECTURE.md`) y modelo de datos (`docs/DATA_MODEL.md`).
- Esquema D1 normalizado en migraciones versionadas: `0001_schema.sql`,
  `0002_reference_data.sql`, `0003_assignment_batch_unique.sql`,
  `0004_materials_photo.sql` y `0005_storage_objects_scope.sql`. Sin datos
  personales; solo permisos, roles, condiciones físicas, calidades y secciones
  del sitio como datos de referencia.
- **Seguridad desde el primer despliegue:** contraseñas PBKDF2-SHA256 con sal y
  *pepper*; sesiones opacas revocables en cookie `HttpOnly`; CSRF obligatorio en
  operaciones con estado; autorización por permiso en el servidor; limitación de
  intentos con bloqueo; auditoría saneada; inicialización del primer
  administrador con token de un solo uso.
- **Inventario:** catálogo de materiales, categorías, tipos, marcas, modelos y
  tallas; existencias por ubicación y condición; unidades individualizadas con
  código y número de serie; lotes; stock mínimo; fotografías; historial de
  movimientos.
- **Personal y cargos:** fichas con calidad, cargos configurables por institución
  (sin jerarquía fija), historial de entregas y devoluciones, foto privada y
  ficha imprimible.
- **Asignaciones y devoluciones:** entregas de una o varias unidades,
  devoluciones totales y parciales, actas imprimibles.
- **Traslados, bajas y mantenimiento:** movimientos parciales, bajas con motivo
  obligatorio y acta, registro de reparaciones e intervenciones.
- **Informes y exportaciones:** siete informes (inventario, material por
  ubicación y categoría, asignaciones, movimientos, bajas, personal y actas) y
  exportación a `.xlsx` real, con generador OOXML propio y protección
  anti-inyección de fórmulas.
- **Sitio web público y gestor de contenidos:** portada configurable con
  secciones que se activan, desactivan y ordenan; páginas, noticias, actividades
  y galerías con borrador, publicación, retirada y archivo; `sitemap.xml` y
  `robots.txt`; identidad institucional (escudo, logotipo, color, portada) sin
  nada fijado en el código.
- **Editor de texto enriquecido** sin dependencias, con saneado estricto en el
  servidor al guardar.
- **Pruebas de integración en el runtime de Workers** con D1 y R2 reales,
  ejecutadas en cada push y en cada versión.
- **Instalación por institución:** plantilla de despliegue en `deploy/` (una
  copia por institución, atada a versiones publicadas) y guarda de publicación
  (`scripts/check-release.mjs`), que impide publicar un tag que no cuadre con
  `package.json` y el historial.

### Corregido

- **Auditoría de seguridad del reconstruido** (informe en `docs/AUDIT.md` y
  `~/security-audit-skill/bomberos-gestion/run-1/`), con su prueba de regresión
  cada corrección:
  - el saneador de enlaces se podía esquivar con tabuladores y saltos de línea,
    y admitía URLs relativas al protocolo;
  - el documento de la SPA en producción no llevaba CSP ni protección de
    enmarcado (ahora el documento lo sirve el Worker con el juego completo de
    cabeceras, más una meta CSP como respaldo);
  - las redes sociales institucionales admitían cualquier esquema (`javascript:`);
  - el acceso a un archivo privado se autorizaba por permiso general y no por
    objeto: ahora cada objeto tiene su ámbito (`site`, `inventory`, `person`) y
    exige el permiso correspondiente, y las referencias se validan al escribir;
  - se podían «acuñar» existencias trasladando desde una ubicación sin fila de
    stock, y registrar bajas sin descontar nada;
  - la idempotencia compartía la respuesta entre usuarios distintos y una
    operación fallida dejaba la clave bloqueada para siempre;
  - las mutaciones de personal y de catálogo no dejaban fila de auditoría;
  - faltaban topes agregados (cuerpo de las peticiones, fotos por galería,
    tamaño total del almacén) y no se limpiaban sesiones, intentos de ingreso ni
    reservas caducadas.

### Notas

- Licencia MIT. Una instalación independiente por institución, sin plataforma
  central ni multitenencia.
- Los límites del plan gratuito de Cloudflare y las decisiones de arquitectura
  están documentados en `docs/ARCHITECTURE.md`.
- Publicar una versión: [`docs/RELEASING.md`](docs/RELEASING.md). Desplegar una
  instalación: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) y
  [`deploy/README.md`](deploy/README.md).
