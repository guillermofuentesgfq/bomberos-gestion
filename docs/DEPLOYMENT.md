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

## 11. Elegir la dirección del sitio

El Worker responde igual en la dirección por la que entre cada visita: no hay
que declararle ningún dominio. Hay dos caminos y no son excluyentes en el
tiempo — se puede empezar por el primero y añadir el segundo más adelante.

### Opción A: solo `workers.dev` (sin dominio propio)

Es la **dirección gratuita que genera Cloudflare** para tu cuenta. Sin dominio,
sin DNS, sin certificado y sin zona que dar de alta: en cuanto despliegas, el
sitio responde, y **sin gastar nada**. Para una instalación nueva es el camino
más corto, y el que recomienda este proyecto empezar.

> **Para qué sirve, y por qué la instalación real debería usar dominio.**
>
> `workers.dev` está aquí por una razón concreta: **dar acceso a coste cero**
> mientras no hay presupuesto para un dominio, o mientras el dominio todavía no
> existe. Para eso cumple bien.
>
> **Para una institución que va a durar, la recomendación es la opción B: un
> dominio propio.** No por una limitación técnica del proyecto —todo funciona
> igual en las dos direcciones— sino por razones que no dependen del código:
>
> - **La dirección es parte de la identidad de la institución.** Una dirección
>   `…workers.dev` es de pruebas; el nombre propio es por el que la comunidad la
>   conoce y el que ya está impreso en redes, impresos y tarjetas.
> - **Cloudflare no lo ofrece como servicio de negocio.** Su documentación trata
>   `workers.dev` como *Free website* y recomienda una ruta o un dominio propio
>   para producción. El plan gratuito lo admite, pero es una decisión de la
>   plataforma, no un derecho: puede cambiar sin aviso.
> - **Un dominio cuesta unos pocos dólares al año** y es un activo propio: la
>   dirección gratuita no lo es. Si mañana cambias de cuenta de Cloudflare, el
>   Worker se va y `…workers.dev` se pierde.
>
> En resumen: **`workers.dev` para empezar y para una instalación de prueba o sin
> presupuesto; dominio propio para la instalación real.** No es una decisión
> irreversible —pasar de A a B no mueve tus datos— así que empezar por A no
> cierra la puerta.

1. **Fija el subdominio de la cuenta antes del primer despliegue.** Es un ajuste
   de cuenta, no del Worker, y determina la dirección de todo lo que despliegues
   después. En el panel: **Workers & Pages → Change** junto a *Your subdomain*.
2. **Elige el nombre del Worker** en tu `wrangler.<institución>.jsonc`. Ese
   `name` **es** la etiqueta de DNS de la dirección, así que con `workers_dev`
   activo tiene que cumplir: **63 caracteres o menos**, solo alfanuméricos y
   guiones, y sin empezar ni terminar en guion. Sin `routes` el límite sube a
   255, pero conviene pensarlo antes de dar el alta y no después.
3. **No declares `routes` ni pongas `workers_dev: false`.** La plantilla de
   ejemplo ya viene así a propósito, con el bloque `routes` comentado, y por
   defecto `workers_dev` está activo. Desplegar es el paso 10, tal cual.
4. Despliega y **anota la dirección** que imprime Wrangler:

   ```bash
   npm run build
   npx wrangler deploy -c wrangler.<institución>.jsonc
   # https://<nombre-del-worker>.<tu-subdominio>.workers.dev
   ```

5. **Comprueba** que `/api/v1/health` responde en esa dirección.

Lo que conviene saber antes de decidirse:

- **El nombre del Worker es la dirección.** Si más adelante lo renombras, cambia
  la URL y la anterior deja de responder. Y como la cookie de sesión es del
  anfitrión, un cambio de dirección obliga a **volver a entrar** a todo el
  mundo. Ponle un nombre estable desde el principio.
- **Cloudflare no lo ofrece como servicio de negocio.** Ver la nota de arriba.
- **Puedes protegerla con Cloudflare Access** (Zero Trust) si quieres exigir
  autenticación antes de dejar entrar, sin cambiar nada del proyecto.
- **Todo lo demás sigue igual.** El `sitemap.xml`, el `robots.txt` y las
  direcciones absolutas (`og:url`, `og:image`) se construyen con el anfitrión de
  cada visita; la cookie de sesión va en `Secure` porque `workers.dev` es HTTPS;
  y el mismo despliegue responde en `workers.dev`, en el dominio propio o en un
  subdominio de pruebas sin reconfigurar nada.

Para pasar de aquí a la opción B no hay que migrar nada: añades `routes` a la
misma configuración y vuelves a desplegar. Tus datos, usuarios y contenido no se
mueven; solo cambia por dónde se entra.

### Opción B: dominio propio

Es la opción recomendada para una instalación que va a durar (ver la nota de la
opción A).

Requisito previo: el dominio tiene que estar dado de alta como **zona en tu
cuenta de Cloudflare** (con sus servidores de nombres apuntando a Cloudflare),
porque el dominio personalizado se crea dentro de esa cuenta. Añádelo con
**Add a site** y cambia los servidores de nombres en tu registrador; hasta que
propague, la zona queda «pendiente» y este paso falla.

Después hay dos caminos. El segundo deja el dominio declarado en el repositorio,
que es lo recomendado:

1. **En el panel:** Workers & Pages → tu Worker → Settings → Domains & Routes →
   Add → Custom domain, y elige el nombre (por ejemplo `tu-dominio.cl` o
   `gestion.tu-dominio.cl`).

2. **Declarado en la configuración (recomendado):** en tu
   `wrangler.<institución>.jsonc`

   ```jsonc
   "routes": [
     { "pattern": "tu-dominio.cl", "custom_domain": true }
   ],
   ```

   Con `custom_domain: true` el propio despliegue crea el registro DNS y el
   certificado: no hay que tocar el panel. Si el dominio todavía no está en tu
   cuenta, el despliegue falla con *«Couldn't find a zone named … in this
   account»* y no publica nada (el sitio sigue como estaba).

> **Al añadir `routes`, la dirección `workers.dev` se apaga sola.** Wrangler
> decide `workers_dev` así: si no lo declaras, vale `routes.length === 0`. En
> cuanto tu bloque `routes` tiene una entrada, el valor por defecto pasa a
> `false` y `…workers.dev` deja de responder **en ese mismo despliegue**.
>
> Si quieres que el sitio responda en las dos direcciones mientras el dominio
> propaga, **decláralo explícitamente** junto a `routes`:
>
> ```jsonc
> "workers_dev": true,
> "routes": [
>   { "pattern": "tu-dominio.cl", "custom_domain": true }
> ]
> ```
>
> Y cuando el dominio esté funcionando, vuelve a ponerlo en `false` (o quítalo)
> y despliega: dos direcciones para el mismo sitio es contenido duplicado para
> los buscadores.

Si ya tienes un sitio en ese mismo nombre, añadir el Worker ahí lo sustituye (la
interfaz te avisa del registro en conflicto); para convivir con él, usa un
subdominio.

**Si quieres que `www.tu-dominio.cl` también responda**, añádelo como una segunda
entrada en `routes`. El mismo Worker sirve las dos direcciones, con dos
consecuencias que conviene conocer antes:

- **Sesiones separadas.** La cookie de sesión es del anfitrión: quien entre por
  `www` no estará identificado en el dominio sin `www`, y al revés.
- **Contenido duplicado.** El `sitemap.xml` y las direcciones que se comparten
  (`og:url`) se construyen con el anfitrión de cada visita.

Lo recomendable es elegir **una** dirección canónica y redirigir la otra con una
**Regla de redirección** (en el panel, *Rules → Redirect Rules*; disponible en el
plan gratuito —10 reglas y comodines— y requiere el DNS de la zona en Cloudflare,
que es el caso al usar dominios personalizados). Un archivo `_redirects` **no**
sirve para esto: en Workers no admite reglas por dominio y no se aplica a las
respuestas que genera el Worker, y la portada la sirve el Worker.

Comprobación: `/api/v1/health` responde en el dominio nuevo. A partir de ahí el
dominio es la dirección del sitio, y `workers.dev` es opcional (ver la nota sobre
`workers_dev` más arriba): si la mantuviste abierta durante la propagación,
ciérrala con `"workers_dev": false` y vuelve a desplegar, porque dos direcciones
para el mismo sitio es contenido duplicado para los buscadores.

**El Worker no necesita que le digas cuál es el dominio.** El `sitemap.xml`, el
`robots.txt` y las direcciones absolutas (`og:url`, `og:image`) se construyen a
partir de la dirección por la que entra cada visita, y la sesión va en una cookie
de ese mismo anfitrión. El campo `siteUrl` de los ajustes de SEO existe para un uso
futuro y hoy no se consume.

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
