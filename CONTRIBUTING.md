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

## Pull requests

1. Crea una rama descriptiva (`feat/…`, `fix/…`, `docs/…`).
2. Asegúrate de que typecheck, build y pruebas pasan.
3. Describe qué cambia y por qué; enlaza la incidencia si existe.
4. No incluyas datos personales, credenciales ni secretos.

## Licencia de las contribuciones

Al contribuir aceptas que tu aporte se publique bajo la licencia MIT del
proyecto.
