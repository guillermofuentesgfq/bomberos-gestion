# Historial de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [Versionado Semántico](https://semver.org/lang/es/). El
procedimiento para publicar una versión está en
[`docs/RELEASING.md`](docs/RELEASING.md).

## [No publicado]

### Añadido

- **Campo «Cuerpo de Bomberos» en los ajustes** (Ajustes → Información
  institucional). Es el nombre del cuerpo al que pertenece la institución, tal
  como se escribe en los documentos oficiales: por ejemplo, «Cuerpo de Bomberos
  de Concepción». Aparece en el encabezado y el pie del sitio público y en el
  membrete de todo lo que se puede imprimir —actas de entrega y baja, ficha del
  personal e inventario.

  No es el campo «Información del cuerpo de bomberos» que ya existía: aquel es
  un párrafo en HTML para la sección «La compañía» de la portada, y este es un
  nombre corto en texto plano. **No hace falta migración**, porque la
  configuración institucional es una tabla de clave/valor y una clave nueva es
  solo una fila más.

  Los cuatro membretes lo muestran **entre el nombre y el número**, y solo si
  tiene contenido: una instalación que no lo rellene ve exactamente lo mismo que
  antes.

## [0.1.3] - 2026-10-18

Un fallo visible en la portada y la guía que faltaba para instalar sin dominio
propio. **Nada de esto exige ninguna acción al actualizar**: no hay migraciones
nuevas ni cambios de esquema.

### Corregido

- **Los botones de la portada respetaban las secciones desactivadas.** El héroe
  mostraba siempre los enlaces «Contacto» y «Noticias», escritos a mano en el
  componente y sin mirar la configuración. Con la sección de contacto
  desactivada, además, «Contacto» quedaba como un ancla rota: apuntaba a
  `/#contact`, un ancla que ya no existía en la página. Ahora ambos enlaces
  aparecen solo si su sección está habilitada, igual que el resto de la portada.

### Añadido

- **Guía de despliegue en modo `workers.dev`** (`docs/DEPLOYMENT.md` §11 y la
  plantilla `deploy/wrangler-instancia.example.jsonc`). El paso sobre la
  dirección del sitio distinguía entre hacerlo en el panel o declararlo en la
  configuración, pero daba por hecho que había dominio propio. Ahora la opción
  sin dominio —la dirección gratuita que genera Cloudflare para la cuenta— es
  la primera y recomendada, con lo que conviene saber antes de decidirse: que el
  nombre del Worker **es** la etiqueta de DNS (63 caracteres, alfanuméricos y
  guiones) y que renovarlo cambia la URL y obliga a volver a entrar; que el
  subdominio se fija a nivel de cuenta y conviene fijarlo antes del primer
  despliegue; y que a Cloudflare su documentación no lo trata como sitio de
  negocio, aunque la instalación funcione igual y sin coste.
- **Reglas y punteros de exploración con el grafo de conocimiento**
  (`AGENTS.md`, `CLAUDE.md` y el cableado local de las agent skills). Se ignoran
  las skills vendorizadas, que según `SECURITY.md` y `CONTRIBUTING.md` se
  instalan por máquina y no se versionan.

## [0.1.2] - 2026-10-16

Corrige el fallo que impedía terminar la puesta en marcha de una instalación
real: **no se podía crear el primer administrador**.

### Corregido

- **Las contraseñas se cifraban con 210 000 iteraciones de PBKDF2 y Cloudflare
  admite 100 000 como máximo** (`Pbkdf2 failed: iteration counts above 100000 are
  not supported`). El runtime local de las pruebas no aplica ese tope, así que
  las 176 pruebas pasaban y el fallo aparecía en el primer despliegue de verdad,
  al usar el asistente. Ahora se usan 100 000, el máximo permitido, y hay una
  prueba de contrato que impide volver a subirlo sin comprobarlo en producción.
- **El asistente de arranque ya no deriva la contraseña dos veces.** Creaba el
  administrador (una derivación) y después llamaba al ingreso, que la verificaba
  (otra): unas dos veces 5 ms de CPU en la misma petición, cuando el plan
  gratuito concede 10 ms. Ahora abre la sesión directamente.
- **`listObjectSummaries` trocea la consulta.** Construía un `IN (...)` con una
  posición por imagen (todas las páginas, noticias y actividades del sitio) y D1
  admite 100 parámetros por consulta; con un sitio con contenido habría fallado
  en producción aunque en local funcionara.
- **Los patrones `LIKE` de la búsqueda se recortan a 50 bytes**, que es el tope
  que D1 admite, sin partir caracteres y sin dejar una barra de escape suelta.
  Antes se permitían términos de 120 caracteres.

### Notas

- Se documenta la clase de fallo en `docs/ARCHITECTURE.md` («Límites que las
  pruebas locales **no** aplican»), en `CONTRIBUTING.md` y en `SECURITY.md`, con
  los límites verificados en la documentación de Cloudflare (Workers y D1) y el
  coste medido de PBKDF2.
- **Aviso de plan:** con el plan gratuito el acceso va justo de CPU (10 ms por
  petición, ~5 ms por derivación). Si un despliegue devuelve el error 1102, la
  salida es el plan de pago o bajar las iteraciones, nunca subirlas.

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
