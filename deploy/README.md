# Instalación por institución (copia del proyecto)

Este directorio contiene la **plantilla** para dejar una instalación
independiente atada a las **versiones publicadas** del proyecto. Cada institución
mantiene su propio repositorio, despliega solo releases etiquetados y recibe las
actualizaciones fusionando el tag nuevo.

> El proyecto es de **una instalación por institución**: cada una tiene su cuenta
> de Cloudflare, su base D1, su bucket R2, sus usuarios y su dominio. No hay
> plataforma central.

---

## Por qué una copia y no una edición del proyecto

Editar `wrangler.jsonc` de este repositorio funciona la primera vez y duele para
siempre: ese archivo **le pertenece al proyecto** y cambia cada vez que el
upstream añade una ruta o un ajuste, así que cada actualización chocaría contra
tu copia.

La copia no toca **ningún** archivo del proyecto. Añade solo archivos propios:

| Archivo propio (no existe en el proyecto) | Para qué |
|---|---|
| `wrangler.<institución>.jsonc` (en la raíz) | Tu Worker, tu D1 y tu bucket |
| `.github/workflows/deploy.yml` | Desplegar al empujar un tag |
| `INSTANCIA.md` (recomendado) | Lo que es propio de esta instalación: nombres, cuenta, dominio y quién la mantiene |

Así, actualizar es siempre `git merge <tag>` y **nunca** hay conflictos.

### La trampa de las rutas

Wrangler resuelve `main`, `assets.directory` y `migrations_dir` **relativos al
archivo de configuración**. Por eso la configuración de la institución va en la
**raíz** del repositorio y no dentro de `deploy/`: desde aquí, Wrangler buscaría
`deploy/src/worker/index.ts` y fallaría con *«entry-point file was not found»*.
Comprobado con `wrangler deploy --dry-run`.

---

## Puesta en marcha de una institución

### 1. Crear el repositorio de la institución

```bash
git clone git@github.com:<cuenta>/bomberos-gestion.git bomberos-<institución>
cd bomberos-<institución>
git remote rename origin upstream        # el proyecto, solo para actualizar
git remote add origin git@github.com:<cuenta>/bomberos-<institución>.git
git push -u origin main
```

### 2. Crear los recursos en la cuenta de Cloudflare

```bash
npx wrangler login
npx wrangler d1 create bomberos-<institución>
npx wrangler r2 bucket create bomberos-<institución>-files
```

Copia el `database_id` que devuelve `d1 create`.

### 3. Copiar la plantilla y rellenar los valores

```bash
cp deploy/wrangler-instancia.example.jsonc wrangler.<institución>.jsonc
cp deploy/deploy.example.yml .github/workflows/deploy.yml
```

En `wrangler.<institución>.jsonc`, sustituye los marcadores: `name`,
`database_name`, `database_id`, `bucket_name`. **Nunca** escribas secretos ahí.

### 4. Definir los secretos

Tres secretos del Worker, todos con 32 bytes aleatorios distintos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # una vez por secreto
npx wrangler secret put AUTH_PASSWORD_PEPPER -c wrangler.<institución>.jsonc
npx wrangler secret put AUTH_SESSION_SECRET  -c wrangler.<institución>.jsonc
npx wrangler secret put BOOTSTRAP_TOKEN      -c wrangler.<institución>.jsonc
```

`BOOTSTRAP_TOKEN` sirve una sola vez, para crear el primer administrador;
elimínalo después con `npx wrangler secret delete BOOTSTRAP_TOKEN`.

Y dos secretos del repositorio (Settings → Secrets and variables → Actions) para
que el despliegue automático funcione:

| Secreto | Contenido |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de API con *Workers Scripts: Edit*, *D1: Edit* y *R2: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | El identificador de la cuenta, visible en el panel |

### 5. Primer despliegue

```bash
npm install
npx wrangler d1 migrations apply DB --remote -c wrangler.<institución>.jsonc
npm run build
npx wrangler deploy -c wrangler.<institución>.jsonc
```

Al terminar, entra en `/setup` de la URL que devuelve Wrangler, pega el
`BOOTSTRAP_TOKEN`, crea el administrador y **retira el token**.

El resto de la puesta en marcha (dominio, personalización del sitio y usuarios)
está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

---

## Actualizar a una versión publicada

El proyecto publica versiones etiquetadas (`vX.Y.Z`) en
[`../docs/RELEASING.md`](../docs/RELEASING.md). Para actualizar una instalación:

```bash
git fetch upstream --tags
git merge v0.1.0                    # el release que quieres; sin conflictos
git push origin main
git push origin v0.1.0              # el tag de la versión, para que el despliegue lo verifique
git tag deploy/v0.1.0               # la decisión de desplegarla en ESTA institución
git push origin deploy/v0.1.0       # ← aquí se dispara el despliegue
```

Antes de etiquetar, lee la sección **Actualizaciones** de
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md): indica cómo comprobar qué
migraciones nuevas trae la versión y qué mirar después de desplegar.

### Comprobar antes de desplegar

```bash
git log --oneline v0.1.0..v0.2.0                      # qué cambios trae
git diff v0.1.0..v0.2.0 -- migrations/                # migraciones nuevas
npm ci && npm run typecheck && npm run test           # que todo siga verde
npx wrangler deploy --dry-run -c wrangler.<institución>.jsonc   # que el Worker se construya
```

El despliegue en sí lo hace GitHub Actions al empujar `deploy/vX.Y.Z`, y su
primera comprobación es que el tag corresponda a un release con su sección en el
CHANGELOG: **no se puede desplegar un commit suelto sin darse cuenta**.
