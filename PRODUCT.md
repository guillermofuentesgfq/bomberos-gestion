# PRODUCT.md

Verdad de producto duradera de **bomberos-gestion**. Este documento describe a
quién sirve, para qué existe y bajo qué restricciones se opera. No cambia con
cada versión; los detalles técnicos viven en `docs/` y el diseño visual en
`DESIGN.md`.

---

## Qué es

Sistema **open source** y **autodesplegable** de gestión de **inventario**,
**personal** y **sitio web público institucional** para compañías y cuerpos de
bomberos de Chile.

Cada institución descarga, configura y opera su **propia instalación
independiente** en su **propia cuenta de Cloudflare**. No hay plataforma
central, no hay multitenencia y no hay dependencia de un servicio de gestión
externo.

## Audiencia

| Audiencia | Rol | Contexto de uso |
|---|---|---|
| **Voluntarios y oficiales de compañía** | Usuarios diarios del panel | Uso esporádico, en cuartel o desde el teléfono, muchas veces sin perfil técnico |
| **Encargado de inventario / material mayor** | Responsable del catálogo, asignaciones, traslados y bajas | Sesiones de trabajo concentradas, escritorio, alta densidad de datos |
| **Secretaría / administración** | Personal, actas, informes y exportaciones | Tareas repetitivas, impresión de documentos, trazabilidad |
| **Responsable técnico de la instalación** | Despliega y mantiene la instancia | Voluntario o colaborador con conocimientos básicos; sin equipo de TI dedicado |
| **Público general / comunidad** | Visitantes del sitio institucional | Móvil, busca noticias, contacto, historia y especialidades |
| **Desarrolladores y colaboradores OSS** | Construyen y mantienen el proyecto | Repositorio único, contribuciones sin infraestructura compartida |

## Propósito

Dar a cada compañía o cuerpo de bomberos una herramienta **confiable, rastreable
y mantenible por sus propios medios** para responder tres preguntas operativas:

1. **Qué tenemos** — inventario, ubicaciones, stock mínimo, estados y condiciones.
2. **Quién lo tiene** — asignaciones, devoluciones y responsabilidad por unidad.
3. **Qué pasó** — movimientos, bajas con motivo, mantenimiento e historial.

Y, además, una **vitrina pública** que la institución administra sin tocar código.

## Contexto operativo

- **Instituciones pequeñas y medianas**, recursos limitados, presupuesto cercano a cero.
- **Sin equipo de TI**: la instalación debe ser desplegable siguiendo documentación paso a paso.
- **Voluntariado**: la continuidad depende de que el sistema siga funcionando cuando las personas cambian.
- **Uso discontinuo**: entre emergencias y actividades; la interfaz debe ser **reaprendible** sin memoria previa.
- **Datos sensibles** (personas, material, direcciones) que no deben salir de la cuenta de la institución.
- **Uso móvil en terreno** y **escritorio en oficina** con la misma base de datos.
- **Impresión** de actas y documentos como parte del flujo real.

## Restricciones (duras)

- **Una instalación = una institución.** El diseño no puede asumir múltiples
  instituciones ni _tenant switching_.
- **Sin servicios externos obligatorios.** Nada de cuentas de terceros, analítica
  o CDN de fuentes privativas que rompan la autosuficiencia.
- **Colores institucionales configurables en tiempo de ejecución** por
  institución (`--brand-primary` / `--brand-secondary`). La identidad visual de
  respaldo es sobria y neutra; cada cuerpo puede cambiarla.
- **Idioma: español de Chile.** Tono formal, claro, sin anglicismos innecesarios.
- **Accesibilidad AA** como mínimo, no como extra: contraste, foco visible,
  navegación por teclado, objetivos táctiles y movimiento reducido.
- **Stack fijo:** React 19 + Vite 8 + Tailwind CSS v4 (`@import 'tailwindcss'` y
  tokens con `@theme` en `src/web/index.css`) + TypeScript estricto.
- **Un solo Cloudflare Worker** (Hono + Zod) sirve API y SPA desde el mismo
  origen; D1 como base de datos, R2 privado para archivos.
- **Portabilidad de datos** y **trazabilidad de operaciones** como requisitos,
  no como mejoras futuras.

## Dos superficies, un sistema

1. **Panel administrativo** — denso, orientado a tablas, formularios, filtros,
   estados vacíos y acciones masivas. Prioriza eficiencia y precisión por sobre
   la expresividad.
2. **Sitio público institucional** — hero, historia, misión/visión,
   especialidades, galería, noticias y contacto. Prioriza credibilidad,
   legibilidad y sobriedad institucional.

Comparten tokens, tipografía y reglas de accesibilidad. No comparten densidad.

## Voz y tono

- **Institucional y sobrio.** Habla como el cuerpo de bomberos, no como una _startup_.
- **Claro y directo.** Frases cortas, verbos concretos, sin jerga técnica frente al usuario final.
- **Cercano sin ser informal.** Trata de "usted" en el sitio público y en textos formales; el panel puede usar etiquetas directas ("Guardar", "Asignar").
- **Respetuoso del contexto.** Nunca minimiza la emergencia ni usa metáforas lúdicas.
- **Consistente.** Un mismo objeto se llama igual en todo el sistema ("unidad", "asignación", "baja", "traslado").
- **Nunca genérico.** Sin eslóganes vacíos ni lenguaje de marketing inflado.
- **Reconocible por institución.** El nombre, escudo y colores del cuerpo aparecen donde corresponde; el software no compite con la institución.

## Evidencias

- `README.md` — qué es y qué no es, funcionalidad, arquitectura y principios.
- `docs/ARCHITECTURE.md` — arquitectura, capas y decisiones.
- `docs/DATA_MODEL.md` — esquema de datos y propósito de cada tabla.
- `docs/DEPLOYMENT.md` — instalación y despliegue paso a paso.
- `src/web/index.css` — tokens base y variables de color institucional de respaldo.
- `design-system/bomberos-gestion/MASTER.md` — sistema de diseño generado
  (patrón, estilo, paleta de referencia, tipografía, movimiento).
- `DESIGN.md` — dirección visual y contrato de tokens derivados del Master.
