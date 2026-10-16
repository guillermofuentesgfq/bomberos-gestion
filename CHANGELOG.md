# Historial de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

### Añadido

- Auditoría del sistema original y matriz de paridad (`docs/AUDIT.md`).
- Arquitectura documentada (`docs/ARCHITECTURE.md`) y modelo de datos
  (`docs/DATA_MODEL.md`).
- Esquema D1 normalizado en migraciones versionadas:
  - `0001_schema.sql`: configuración, usuarios/roles/sesiones/auditoría,
    almacenamiento, catálogos, inventario, personas, movimientos, asignaciones y
    devoluciones parciales, traslados, bajas, mantenimiento, idempotencia y CMS.
  - `0002_reference_data.sql`: permisos, cinco roles iniciales, condiciones
    físicas, calidades y secciones del sitio. Sin datos personales.
- Esqueleto del Worker (Hono + Zod, TypeScript estricto) con:
  - sonda de salud `GET /api/v1/health`;
  - cabeceras de seguridad y CSP por defecto;
  - límite de tamaño de solicitud;
  - respuestas JSON uniformes y manejo de errores sin filtrar detalles internos.
- Esqueleto de la SPA (React + Vite + Tailwind) servida como Static Assets con
  fallback y proxy de API en desarrollo.
- Herramientas de proyecto: `wrangler.jsonc`, `tsconfig.json` estricto,
  `vitest.config.ts`, `scripts/check-docs.mjs`.
- Documentación: README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, TESTING,
  DEPLOYMENT, BACKUP_AND_RESTORE y CHANGELOG.
- Licencia MIT.

### Notas

- Instalación **vacía**: sin datos personales ni imágenes del sistema original.
- Los límites del plan gratuito de Cloudflare quedan documentados en
  `docs/ARCHITECTURE.md`.
