# Instalación y despliegue

Guía paso a paso para que una institución sin equipo profesional de desarrollo
pueda dejar su instalación funcionando en su **propia** cuenta de Cloudflare.

> Este documento se completará a medida que avancen las fases. Los pasos están
> ordenados y son los definitivos; los puntos marcados como *(pendiente)* se
> habilitan en fases posteriores.

## 1. Crear una cuenta de Cloudflare

1. Entra en <https://dash.cloudflare.com/sign-up> y crea una cuenta.
2. Confirma el correo. El plan gratuito es suficiente para empezar.

## 2. Clonar el repositorio

```bash
git clone git@github-personal:guillermofuentesgfq/bomberos-gestion.git
cd bomberos-gestion
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

Revisa `wrangler.jsonc`. El nombre del Worker es `bomberos-gestion`; puedes
cambiarlo si lo deseas.

## 5. Crear la base de datos D1

```bash
npx wrangler d1 create bomberos-gestion
```

Copia el `database_id` que devuelve y pégalo en `wrangler.jsonc`, sustituyendo
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 6. Crear el bucket R2

```bash
npx wrangler r2 bucket create bomberos-gestion-files
```

Los archivos son privados por defecto; no se expone acceso público.

## 7. Ejecutar las migraciones

En local (desarrollo):

```bash
npm run db:migrate:local
```

En la base remota:

```bash
npm run db:migrate:remote
```

## 8. Configurar los secretos

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # para cada secreto
npx wrangler secret put AUTH_PASSWORD_PEPPER
npx wrangler secret put AUTH_SESSION_SECRET
npx wrangler secret put BOOTSTRAP_TOKEN
```

No escribas secretos en `wrangler.jsonc` ni en el repositorio.

## 9. Crear el primer administrador *(pendiente)*

El procedimiento de inicialización requiere `BOOTSTRAP_TOKEN` y se ejecuta una
sola vez. Tras crear el administrador, **elimina** el secreto de arranque.

## 10. Compilar y desplegar

```bash
npm run deploy
```

## 11. Configurar el dominio *(pendiente)*

Añade tu dominio en Cloudflare y publica la instalación. Verás la comprobación
en `/api/v1/health`.

## 12. Personalizar la web institucional *(pendiente)*

Desde el panel administrativo: nombre, escudo, colores, historia, contacto,
secciones y contenido.

## 13. Crear los usuarios *(pendiente)*

Crea las cuentas y asigna roles: administrador, responsable de inventario,
responsable de asignaciones, editor del sitio y consulta.

## 14. Verificar el respaldo y la restauración

Sigue [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md) y comprueba que puedes
exportar y restaurar tu base de datos.

---

## Actualizaciones

Para actualizar una instalación existente conservando sus datos: haz respaldo,
trae los cambios del repositorio, aplica las migraciones nuevas
(`npm run db:migrate:remote`) y vuelve a desplegar (`npm run deploy`).
