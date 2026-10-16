# Instalación y despliegue

Guía paso a paso para dejar una instalación funcionando en la **propia** cuenta
de Cloudflare de la institución. Cada institución tiene su cuenta, su base de
datos, su bucket, sus usuarios y su dominio: no hay plataforma central.

Si vas a mantener la instalación en el tiempo (lo normal), sigue la guía de
instalación por institución de [`../deploy/README.md`](../deploy/README.md):
crea tu propio repositorio, despliega solo versiones publicadas y recibe las
actualizaciones fusionando tags. Este documento describe los pasos comunes.

---

## 1. Crear una cuenta de Cloudflare

1. Entra en <https://dash.cloudflare.com/sign-up> y crea una cuenta.
2. Confirma el correo. El plan gratuito es suficiente para empezar.

## 2. Clonar el repositorio

```bash
git clone https://github.com/guillermofuentesgfq/bomberos-gestion.git
cd bomberos-gestion
```

Si vas a desplegar una versión concreta (recomendado), sitúate en su tag:

```bash
git fetch --tags
git checkout v0.1.0
```

## 3. Instalar las herramientas

- Instala **Node.js 22 o superior** (<https://nodejs.org>).
- En la carpeta del proyecto:

```bash
npm install
npx wrangler login
```

`wrangler login` abre el navegador para autorizar la cuenta de Cloudflare.

## 4. Configurar Wrangler

Tienes dos caminos:

- **Una instalación propia y duradera (recomendado).** Copia
  `deploy/wrangler-instancia.example.jsonc` a la **raíz** del repositorio con un
  nombre propio (`wrangler.<institución>.jsonc`), rellena los valores y despliega
  siempre con `-c wrangler.<institución>.jsonc`. Así `wrangler.jsonc` queda
  intacto y las actualizaciones del proyecto nunca chocan.
- **Una instalación de prueba.** Edita `wrangler.jsonc` directamente y despliega
  con `npm run deploy`. Ten en cuenta que cada actualización del proyecto chocará
  con ese archivo.

> **Trampa comprobada:** Wrangler resuelve `main`, `assets.directory` y
> `migrations_dir` **relativos al archivo de configuración**. La configuración de
> la institución va en la **raíz**; dentro de `deploy/` buscaría
> `deploy/src/worker/index.ts` y fallaría con *«entry-point file was not found»*.

## 5. Crear la base de datos D1

```bash
npx wrangler d1 create bomberos-<institución>
```

Copia el `database_id` que devuelve y pégalo en tu configuración
(`database_id`), sustituyendo `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 6. Crear el bucket R2

```bash
npx wrangler r2 bucket create bomberos-<institución>-files
```

Ajusta `bucket_name` en tu configuración. Los archivos son privados: nada se
expone de forma pública, ni siquiera la portada del sitio (la sirve el Worker).

## 7. Ejecutar las migraciones

En local (desarrollo):

```bash
npm run db:migrate:local
```

En la base remota:

```bash
npx wrangler d1 migrations apply DB --remote -c wrangler.<institución>.jsonc
```

Las migraciones son acumulativas y van en orden. Se aplican **antes** de publicar
el código nuevo: el código anterior convive con el esquema nuevo (las migraciones
añaden; no renombran ni borran).

## 8. Configurar los secretos

Tres secretos del Worker, cada uno con 32 bytes aleatorios **distintos**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # una vez por secreto
npx wrangler secret put AUTH_PASSWORD_PEPPER -c wrangler.<institución>.jsonc
npx wrangler secret put AUTH_SESSION_SECRET  -c wrangler.<institución>.jsonc
npx wrangler secret put BOOTSTRAP_TOKEN      -c wrangler.<institución>.jsonc
```

| Secreto | Para qué |
|---|---|
| `AUTH_PASSWORD_PEPPER` | Se mezcla en el hash de contraseñas. Mínimo 16 caracteres. |
| `AUTH_SESSION_SECRET` | Deriva los hashes de sesión y de IP. |
| `BOOTSTRAP_TOKEN` | Un solo uso, para crear el primer administrador. |

Nunca escribas secretos en `wrangler.jsonc`, en tu configuración de institución
ni en el repositorio. En producción, `AUTH_SESSION_SECRET` es obligatorio: sin
él el Worker se niega a derivar hashes en vez de usar un valor por defecto.

## 9. Crear el primer administrador

1. Despliega primero (sección 10) o levanta el entorno local.
2. Entra en `/setup` de la instalación.
3. Pega el **token de inicialización** (`BOOTSTRAP_TOKEN`), elige usuario, nombre
   para mostrar y una contraseña de **al menos 12 caracteres**.
4. Al confirmar se crea el **administrador** y la sesión queda iniciada. El
   asistente solo funciona mientras no exista ningún usuario.
5. **Retira el token de arranque**, que ya no sirve para nada:

   ```bash
   npx wrangler secret delete BOOTSTRAP_TOKEN -c wrangler.<institución>.jsonc
   ```

   Los intentos de adivinar ese token están limitados por IP, pero un token que
   ya no existe no se puede adivinar.

## 10. Compilar y desplegar

```bash
npm run build
npx wrangler deploy -c wrangler.<institución>.jsonc
```

El Worker queda en `https://<nombre-del-worker>.<tu-subdominio>.workers.dev`. Con
el despliegue se registra también el **cron diario** (`0 4 * * *`) que retira
sesiones caducadas, intentos de ingreso viejos y reservas de idempotencia
vencidas. La auditoría **no** se purga: es el rastro de la instalación y su
retención la decides tú.

## 11. Configurar el dominio

1. Añade tu dominio a Cloudflare (si no lo está ya) y deja que gestione su DNS.
2. En el panel del Worker: **Settings → Domains & Routes → Add → Custom domain**,
   y elige el subdominio (por ejemplo `gestion.bomberos.example`).
3. Cloudflare crea el registro y el certificado. En minutos responde en HTTPS.
4. La comprobación del servicio está en `/api/v1/health`.

## 12. Personalizar la web institucional

Desde el panel administrativo (**Ajustes** y **Contenido**): nombre y número de
la institución, escudo, logotipo, color principal, foto de portada, textos de
inicio, historia, contacto y redes; y las páginas, noticias, actividades y
galerías del sitio público. Todo se edita sin tocar código, y el contenido pasa
de borrador a publicado cuando lo decidas.

## 13. Crear los usuarios

En **Usuarios** (visible para quien tenga permiso de lectura de usuarios): crea
cada cuenta con una **contraseña temporal** y asigna los roles existentes —
administrador, responsable de inventario, responsable de asignaciones, editor del
sitio y consulta. Al entrar por primera vez, la persona debe cambiar la
contraseña. La instalación no puede quedarse sin ningún administrador activo: el
sistema lo impide.

## 14. Verificar el respaldo y la restauración

Sigue [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md) y comprueba que puedes
exportar y restaurar tu base de datos. Hazlo **antes** de la primera
actualización, no después.

---

## Actualizaciones

Las actualizaciones se hacen **desde una versión publicada** (ver
[`RELEASING.md`](RELEASING.md)), nunca desde `main`: `main` no está garantizado.
En una instalación en su propio repositorio, el despliegue lo dispara un tag
`deploy/vX.Y.Z`; los pasos completos están en
[`../deploy/README.md`](../deploy/README.md).

Antes de actualizar, comprueba tres cosas:

```bash
git log --oneline v0.1.0..v0.2.0                     # qué cambia
git diff v0.1.0..v0.2.0 -- migrations/               # migraciones nuevas
git diff v0.1.0..v0.2.0 -- CHANGELOG.md              # qué avisa la versión
```

Y sigue este orden, que es el que respeta los datos:

1. **Respaldo primero.** Exporta la base según
   [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md). Una migración no se deshace
   con otro despliegue.
2. **Traer la versión.** `git fetch upstream --tags` y fusiona el tag.
3. **Migrar antes de desplegar.** Las migraciones añaden al esquema; el código
   anterior convive con él. Al revés, no.
4. **Desplegar** el código nuevo.
5. **Comprobar** en `/api/v1/health`, entrar al panel, revisar inventario y
   personal, y mirar los registros del Worker por si algo avisa.

Si algo va mal, el retroceso es volver a la versión anterior: `git checkout
v0.1.0`, `npm ci && npm run build`, y desplegar de nuevo. Ten en cuenta que **las
migraciones ya aplicadas no se revierten**: por eso el respaldo es el paso 1 y no
el último.
