# bomberos-gestion

Sistema de gestión de **inventario, personal y sitio web institucional** para
compañías y cuerpos de bomberos de Chile.

Proyecto **open source** y **autodesplegable**: cada institución descarga,
configura y opera su **propia instalación independiente** en su **propia cuenta
de Cloudflare**. No hay plataforma central, no hay multitenencia y no hay
dependencia de un servicio externo de gestión.

> **Estado:** versión **v0.3.0**. Funcionalidad completa de inventario, personal,
> asignaciones, informes, sitio público con gestor de contenidos, **importación
> masiva desde planillas** (Excel y CSV), **postulación de nuevos integrantes**
> desde el sitio y **notificaciones por Telegram**. No queda funcionalidad
> pendiente: la antigua idea de importar el volcado SQLite del sistema previo se
> sustituyó por la importación desde planilla. Ver `CHANGELOG.md` y
> `docs/ARCHITECTURE.md`.

---

## Qué es y qué no es

**Es** un sistema que cada compañía o cuerpo instala y mantiene por su cuenta:
su propio backend, base de datos, almacenamiento, usuarios, contraseñas,
configuración, sitio público y dominio.

**No es** un SaaS, no tiene facturación ni suscripciones, no administra clientes
de forma central y no aísla datos de instituciones distintas en una misma
instalación. La configuración representa **una sola institución**.

---

## Funcionalidad

- **Inventario:** catálogo de materiales, categorías, tipos, marcas, modelos y
  tallas; unidades individualizadas con código y número de serie; lotes;
  ubicaciones; stock mínimo; estados y condiciones; fotografías; historial.
- **Personal y cargos:** fichas, cargos configurables por institución (sin
  jerarquía fija), historial de entregas y devoluciones.
- **Asignaciones y devoluciones:** entregas de una o varias unidades,
  devoluciones totales y parciales, actas imprimibles.
- **Traslados, bajas y mantenimiento:** movimientos parciales, bajas con motivo
  obligatorio, registro de reparaciones e intervenciones.
- **Importación masiva desde planilla:** carga de materiales con sus existencias
  y de fichas de personal desde `.xlsx`, `.xls` o `.csv`. Plantillas
  descargables, análisis previo con informe de errores y dos modos de
  confirmación. **Las fotos no se importan.**
- **Postulación de nuevos integrantes:** sección configurable en el sitio
  público con los requisitos de postulación en texto enriquecido, formulario con
  consentimiento, revisión de postulantes, bitácora de contacto interno y
  conversión en ficha de integrante.
- **Notificaciones por Telegram:** un bot publica en un grupo los avisos de la
  instalación (hoy, las postulaciones nuevas). Se habilita desde Ajustes.
- **Informes y exportaciones:** inventario, material por ubicación y categoría,
  asignaciones, movimientos, bajas, personal, actas, postulantes y exportación a
  Excel.
- **Sitio web público institucional:** landing configurable con secciones que se
  activan, desactivan y ordenan, más un gestor de contenidos (páginas, noticias,
  actividades, galerías) sin tocar código.

## Importación de datos

Para mudarse desde otro sistema no hace falta exportar SQL: la instalación
importa **planillas**. Funciona con el orden del panel → **Importar** (aparece
bajo Inventario y bajo Personas, según los permisos de la cuenta).

1. **Descarga la plantilla.** Se genera al vuelo con los encabezados, los
   catálogos de tu instalación (categorías, tipos, ubicaciones, condiciones,
   calidades) y las instrucciones, en `.xlsx` o `.csv`.
2. **Súbela.** Formatos admitidos: `.xlsx`, `.xls` y `.csv` (hasta 10 MB y
   20 000 filas). El archivo se lee **en el navegador**; la API recibe las filas
   por lotes.
3. **Revisa el análisis.** Antes de escribir nada, la pantalla muestra cuántas
   filas son válidas, cuántas tienen error y cuántas traen advertencias, con los
   errores agrupados por causa.
4. **Confirma.** «Todo o nada» solo importa si no hay ningún error; «solo filas
   válidas» importa lo correcto y deja constancia de lo omitido. El informe de
   errores se descarga en Excel.

Qué importa cada plantilla:

- **Materiales:** una fila por material y ubicación, con categoría, tipo, marca,
  modelo, stock mínimo y la cantidad inicial por ubicación y condición. Un mismo
  código repetido reparte existencias entre ubicaciones. Las existencias se
  **suman** a lo que ya hubiera. Un código existente es un error: esta versión no
  reescribe materiales.
- **Personas:** nombre, RUT validado, calidad, cargo, contacto, fechas y notas.
  Un RUT repetido dentro del archivo o ya presente es un error.

**Las fotos no se importan.** Ni de materiales ni de personas: se suben una a una
desde cada ficha, una vez creado el registro. La importación tampoco crea
unidades individuales con serie ni talla; un material marcado como individual se
crea, y sus unidades se cargan después desde su ficha.

Detalle de columnas, códigos de error y límites en
[`docs/IMPORTING.md`](docs/IMPORTING.md).

## Postulación de nuevos integrantes

La portada puede incluir una sección **«Postulación»**, configurable desde
Ajustes → Postulación:

- Título, introducción y **requisitos de postulación en texto enriquecido**
  (saneado en el servidor).
- Apertura y cierre de postulaciones, con su propio mensaje.
- Texto de consentimiento y mensaje de éxito.

El formulario público pide nombre, RUT, fecha de nacimiento, correo, teléfono,
comuna, dirección, disponibilidad y motivación, con una casilla de consentimiento
obligatoria. Las postulaciones caen en **Postulantes** (panel), donde se revisan,
se cambia su estado, se registran notas internas y una **bitácora de contacto**.
Desde ahí se pueden abrir los enlaces de teléfono o WhatsApp y, si avanza el
proceso, convertirlo en ficha de integrante.

No hay envío de correo: **el sistema no manda correos**. Los avisos salen por
Telegram (ver abajo) y el contacto lo hace una persona.

## Notificaciones por Telegram

Cada aviso interno se publica en un grupo de Telegram mediante un bot. Quien
administra la instalación lo habilita **desde Ajustes → Notificaciones**, sin
línea de comandos: pega el token que entrega BotFather, el identificador del
grupo y usa «Enviar mensaje de prueba».

- El token se guarda **cifrado** (AES-256-GCM, con clave derivada de
  `AUTH_SESSION_SECRET`) y la pantalla nunca lo devuelve.
- Por defecto el aviso lleva **solo** el nombre, la comuna y un enlace al panel.
  Incluir teléfono y correo es una decisión explícita (el grupo es un servicio
  externo).
- Si Telegram falla, la operación que originó el aviso (por ejemplo, la
  postulación) **no** se ve afectada: el fallo queda registrado en Ajustes.

Detalle en [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md).

## Arquitectura en una frase

Un único **Cloudflare Worker** (TypeScript + Hono + Zod) sirve la **API REST** y
la **SPA** (React + Vite + Tailwind) desde el mismo origen, con **D1** como base
de datos, **R2 privado** para archivos y **KV** opcional solo para caché.

Detalle completo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y modelo de
datos en [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

---

## Requisitos

- **Node.js 22 o superior** y npm.
- Una cuenta de **Cloudflare** (el plan gratuito es suficiente para empezar).
- Opcional: `git`.

## Puesta en marcha (desarrollo)

Requiere **Node.js 22 o superior**. Si usas `nodenv`, el repositorio fija la
versión con `.node-version`.

```bash
git clone https://github.com/guillermofuentesgfq/bomberos-gestion.git
cd bomberos-gestion
npm install

# 1) Crear los secretos locales y rellenar los valores (no pueden ir vacíos)
cp .env.example .dev.vars
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ejecútalo 2 veces
# pega cada resultado en AUTH_PASSWORD_PEPPER y AUTH_SESSION_SECRET,
# y define un BOOTSTRAP_TOKEN a tu elección.

> **Atención:** `wrangler dev` lee **`.dev.vars`**, no `.env`. Si defines los
> secretos en un `.env`, el servidor no los verá y el asistente rechazará el
> token. Cualquier cambio en `.dev.vars` requiere reiniciar `wrangler dev`.

# 2) Aplicar las migraciones en la base D1 local
npm run db:migrate:local

# 3) Compilar la SPA y levantar API + sitio en el mismo origen
npm run start          # equivale a: npm run build && wrangler dev --local
```

Abre <http://127.0.0.1:8787>. La comprobación del servicio está en
<http://127.0.0.1:8787/api/v1/health>.

### Crear el usuario inicial

En una instalación nueva no existe ningún usuario. Al abrir la aplicación se
muestra el **asistente de primer arranque**:

1. Entra en <http://127.0.0.1:8787/setup>.
2. Pega el **token de inicialización**: es el valor de `BOOTSTRAP_TOKEN` que
   definiste en `.dev.vars` (en desarrollo viene de ejemplo como
   `dev-bootstrap-token`).
3. Elige usuario, nombre para mostrar y una contraseña de **al menos 12
   caracteres**.
4. Al confirmar, la instalación crea el **administrador** y deja la sesión
   iniciada. El asistente solo funciona mientras no exista ningún usuario.

> Tras crear el administrador, **elimina o cambia `BOOTSTRAP_TOKEN`**: en
> producción se define con `wrangler secret put BOOTSTRAP_TOKEN` y se retira
> después del alta.

### Volver a empezar de cero

```bash
npm run local:reset    # borra la base D1 LOCAL y reaplica las migraciones
```

Solo afecta a la base local de desarrollo.

### Desarrollo con recarga en caliente

```bash
npm run dev:api        # API en http://127.0.0.1:8787
npm run dev            # SPA con recarga en http://127.0.0.1:5173 (proxy a /api)
```

### Otros comandos

```bash
npm run typecheck      # TypeScript estricto
npm run test           # pruebas (runtime de Workers)
npm run build          # compila Worker + SPA
npm run docs:check     # documentación exigida
```

## Despliegue

El despliegue completo, paso a paso, está en
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): crear la cuenta, la base D1, el
bucket R2, configurar los secretos, ejecutar las migraciones, crear el primer
administrador, desplegar y configurar el dominio.

---

## Versiones y actualizaciones

Este proyecto **no despliega `main`**: publica versiones etiquetadas (`vX.Y.Z`)
y las instalaciones se atan a ellas. Si mantienes una instalación en el tiempo,
lo recomendable es tu **propio repositorio** que siga los tags del proyecto,
despliegue solo versiones publicadas y reciba las actualizaciones fusionándolas.
La guía está en [`deploy/README.md`](deploy/README.md), el procedimiento de
publicación en [`docs/RELEASING.md`](docs/RELEASING.md) y cómo actualizar una
instalación en la sección *Actualizaciones* de
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
git fetch upstream --tags     # traer las versiones publicadas
git merge v0.3.0              # actualizar a una de ellas
```

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura, capas y decisiones |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Esquema de datos y propósito de cada tabla |
| [`docs/IMPORTING.md`](docs/IMPORTING.md) | Plantillas de importación, columnas y errores |
| [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) | Bot de Telegram: habilitación y avisos |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Auditoría del sistema original y matriz de paridad |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Instalación y despliegue paso a paso |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Cómo se publica una versión |
| [`deploy/README.md`](deploy/README.md) | Instalación por institución, atada a versiones |
| [`docs/BACKUP_AND_RESTORE.md`](docs/BACKUP_AND_RESTORE.md) | Respaldo y restauración |
| [`SECURITY.md`](SECURITY.md) | Modelo de seguridad y reporte de vulnerabilidades |
| [`TESTING.md`](TESTING.md) | Estrategia y ejecución de pruebas |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Cómo contribuir |
| [`CHANGELOG.md`](CHANGELOG.md) | Historial de cambios |

---

## Principios

Proyecto open source y autodesplegable · una instalación independiente por
institución · sin plataforma central · sin cuentas obligatorias en servicios
externos · seguridad desde el diseño · trazabilidad de operaciones · integridad
de inventario · documentación reproducible · portabilidad de datos ·
mantenimiento sencillo por voluntarios o responsables técnicos.

## Licencia

[MIT](LICENSE).
