# Cómo contribuir

Gracias por querer mejorar este proyecto. Está pensado para que cualquier
institución pueda instalarlo y mantenerlo por su cuenta.

## Requisitos de desarrollo

- Node.js 22 o superior, npm.
- Un editor con soporte de TypeScript.
- Opcional: `wrangler` (se usa vía `npx`).

## Puesta en marcha

```bash
npm install
npm run db:migrate:local
npm run dev:api   # API en http://127.0.0.1:8787
npm run dev       # SPA en http://127.0.0.1:5173
```

## Comprobaciones antes de enviar cambios

```bash
npm run typecheck   # TypeScript estricto
npm run build       # compila Worker + SPA
npm run test        # pruebas
npm run docs:check  # documentación exigida presente
```

## Estilo de código

- TypeScript estricto. Sin `any` implícito.
- SQL siempre parametrizado; nunca concatenar valores.
- La lógica de negocio vive en `services/`, no en las rutas.
- Los cambios de existencias usan `UPDATE` condicionales y `batch()`.
- Comentarios y mensajes en español; identificadores en inglés.
- Commits pequeños y descriptivos, en imperativo.

## Agent skills de frontend (opcional)

Durante el desarrollo de la interfaz se usan tres *agent skills*:

| Skill | Instalación | Uso |
|---|---|---|
| ui-ux-pro-max | `npm i -g ui-ux-pro-max-cli && uipro init --ai opencode` | design system maestro |
| taste-skill | `npx skills add https://github.com/Leonxlnx/taste-skill` | dirección de arte de la página pública |
| impeccable | `npx impeccable install` | guía y detector determinista |

Se instalan **por máquina** (`~/.agents/skills/`), no se incluyen en el
repositorio. Solo se commitean los artefactos de diseño generados. La telemetría
de impeccable debe permanecer desactivada.

## Trampas conocidas

Estas ya han costado tiempo. Si vas a tocar alguna de estas zonas, léelas antes.

### Esquema y migraciones

- **Antes de escribir una migración, mira el esquema existente.** Hay columnas que
  llevan ahí desde la primera migración y nunca se conectaron
  (`persons.photo_object_id` era una, y el dominio de usuarios y permisos estaba
  entero **sin ningún endpoint**). Conectar lo que ya existe es más barato y más
  seguro que migrar. Vale igual para el código: `listUsersWithRoles` existía
  completo y no lo llamaba nadie.
- **Los nombres archivados siguen ocupados.** `UNIQUE(name)` cubre también las
  filas con `archived_at`, así que crear una entrada cuyo nombre coincida con una
  archivada devuelve `409`. Afecta a `locations`, `categories`, `material_types`,
  `position_types` y `qualities`.
- **`institution_settings` es clave/valor:** añadir un ajuste nuevo no necesita
  migración.
- Tras cambiar migraciones: `npm run db:migrate:local` y **reiniciar** `wrangler dev`.

### Rutas y configuración

- **`run_worker_first` en `wrangler.jsonc`.** Los *assets* ganan al Worker salvo
  en las rutas listadas, así que una ruta nueva con pinta de archivo estático
  (`/favicon.ico`, `/sitemap.xml`…) hay que añadirla a esa lista o no llegará
  nunca al Worker. El binding `assets.binding: "ASSETS"` es obligatorio para que
  el respaldo de la SPA pueda servir el documento desde el Worker: sin él,
  `env.ASSETS` es `undefined` y la portada responde 500. Y al reenviar la
  respuesta de los assets hay que copiarla (`new Response(response.body,
  response)`): sus cabeceras son inmutables y el middleware no podría añadir las
  de seguridad.
- **`updateInstitutionConfig` usa una lista blanca explícita de claves.** Una clave
  nueva se ignora **en silencio** si no se añade ahí.
- `wrangler` lee **`.dev.vars`**, no `.env`.

### Permisos y seguridad

- **`AUTH_PASSWORD_PEPPER` es opcional en el tipo `Env`.** Compruébalo antes de
  usarlo, como hace `services/auth.ts`; si no, no compila.
- **No se puede dejar la instalación sin administrador activo.** Al tocar usuarios:
  no puedes desactivarte ni quitarte el rol de administrador a ti mismo, no puedes
  archivar tu propia cuenta, y debe quedar siempre al menos un administrador activo.
- **Restablecer una contraseña debe cerrar las sesiones abiertas** de esa persona.
  Si no, quien tuviera la contraseña anterior sigue dentro.
- Contraseñas de **12 caracteres** como mínimo; 5 intentos fallidos bloquean la
  cuenta 15 minutos.

### Archivos

- **R2 nunca es público.** Todo pasa por `GET /api/v1/files/:id`, con sesión y
  permiso. Solo los objetos con `is_public = 1` se sirven sin autenticación.
- **La foto de una persona es un dato personal: siempre privada.** Nunca al sitio
  público.
- **El acceso es por objeto, según su ámbito** (`storage_objects.scope`): ver o
  archivar la foto de una persona exige `persons.read`/`persons.write`, la de un
  material `inventory.read`/`inventory.write`. Publicar exige autoridad del
  sitio. Al subir hay que indicar el `scope`; ver `docs/ARCHITECTURE.md`.

### Interfaz y diseño

- **Sin *kickers*:** nada de rótulo pequeño en mayúsculas con `tracking` encima de
  un titular. La jerarquía la sostienen tamaño, peso y espacio.
- **La tipografía no se cambia.** Atkinson Hyperlegible está elegida por legibilidad
  y va autoalojada: no cargues fuentes externas.
- **No añadas dependencias** si se puede resolver con lo que ya hay.
- **`index.css` contiene el sistema de impresión** de los documentos oficiales
  (`.acta-*`, `.inventory-*`, `.print-*`, `.no-print`, `@media print`, `@page`).
  Añade reglas; no modifiques ni borres las existentes.
- **Tailwind v4:** `translate-*` y `scale-*` emiten las propiedades CSS `translate`
  y `scale`, **no** `transform`. Una `transition-transform` no las anima; usa
  `transition-[translate,opacity]`.
- **Respeta `prefers-reduced-motion`** y anima solo `transform` y `opacity`.

### Pruebas

- **El helper `ApiClient` añade el token CSRF en `post`/`put`/`del`, pero no en
  `request()` directo.** Si usas `request()` contra una ruta con `requireCsrf`,
  pasa `csrf: true` o recibirás un `403` que **parece** un fallo de permisos y no lo
  es.
- **`tests/setup.ts` conserva las tablas de referencia y siembra `qualities`.**
  `position_types` y `qualities` no se limpian entre casos: usa nombres únicos por
  caso.
- La base de datos de cada archivo de prueba es independiente; las tablas de datos
  se vacían antes de cada caso.

## Pull requests

1. Crea una rama descriptiva (`feat/…`, `fix/…`, `docs/…`).
2. Asegúrate de que typecheck, build y pruebas pasan.
3. Describe qué cambia y por qué; enlaza la incidencia si existe.
4. No incluyas datos personales, credenciales ni secretos.

## Licencia de las contribuciones

Al contribuir aceptas que tu aporte se publique bajo la licencia MIT del
proyecto.
