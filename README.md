# bomberos-gestion

Sistema de gestión de **inventario, personal y sitio web institucional** para
compañías y cuerpos de bomberos de Chile.

Proyecto **open source** y **autodesplegable**: cada institución descarga,
configura y opera su **propia instalación independiente** en su **propia cuenta
de Cloudflare**. No hay plataforma central, no hay multitenencia y no hay
dependencia de un servicio externo de gestión.

> **Estado:** en desarrollo. La base técnica (arquitectura, esquema de datos,
> seguridad y despliegue) está en construcción por fases. Ver `CHANGELOG.md` y
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
- **Catastro e importaciones:** registro inicial y validación previa.
- **Informes y exportaciones:** inventario, material por ubicación y categoría,
  asignaciones, movimientos, bajas, personal, actas y exportación a Excel.
- **Sitio web público institucional:** landing configurable con secciones que se
  activan, desactivan y ordenan, más un gestor de contenidos (páginas, noticias,
  actividades, galerías) sin tocar código.

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

```bash
git clone git@github-personal:guillermofuentesgfq/bomberos-gestion.git
cd bomberos-gestion
npm install

# Aplicar las migraciones en la base D1 local
npm run db:migrate:local

# API + assets en http://127.0.0.1:8787
npm run dev:api

# En otra terminal, servidor de desarrollo de la SPA (proxy /api)
npm run dev
```

Comprueba el estado del servicio en `http://127.0.0.1:8787/api/v1/health`.

## Despliegue

El despliegue completo, paso a paso, está en
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): crear la cuenta, la base D1, el
bucket R2, configurar los secretos, ejecutar las migraciones, crear el primer
administrador, desplegar y configurar el dominio.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura, capas y decisiones |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Esquema de datos y propósito de cada tabla |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Auditoría del sistema original y matriz de paridad |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Instalación y despliegue paso a paso |
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
