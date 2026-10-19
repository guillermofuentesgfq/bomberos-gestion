# Seguridad

Este documento describe el modelo de seguridad y cómo reportar vulnerabilidades.

## Reporte de vulnerabilidades

No abras una incidencia pública para un problema de seguridad. Usa el reporte
privado de GitHub: en la pestaña **Security** del repositorio, en
**Report a vulnerability**. Es un canal privado entre tú y los mantenedores: lo
que escribes no aparece como incidencia hasta que se decide publicarlo.

Da tiempo razonable antes de divulgarlo. Incluye: descripción, impacto, pasos de
reproducción y versión.

Si no puedes usar ese canal, escribe en privado a los mantenedores por la vía que
prefieras.

## Modelo de amenazas

La instalación la opera una institución en su propia cuenta. Las amenazas
principales son: acceso no autorizado, elevación de privilegios, manipulación
del inventario, fuga de datos personales, exposición de archivos privados y
abuso automatizado.

## Autenticación

- Sin contraseñas por defecto. El primer administrador se crea con un
  procedimiento de inicialización protegido por un token de un solo uso
  (`BOOTSTRAP_TOKEN`), que debe retirarse tras el alta.
- Hash resistente (PBKDF2-SHA256 con sal única por usuario y un *pepper*
  secreto). Parámetros almacenados junto al hash para poder migrarlos, así que
  cambiarlos no invalida las contraseñas existentes.
  - **100 000 iteraciones**, que es el máximo que admite el runtime de Cloudflare
    (rechaza cualquier cifra superior). Queda por debajo de la recomendación de
    OWASP de 600 000 porque la plataforma no lo permite; lo compensan el
    *pepper* —un secreto que vive en el Worker, no en la base, así que un volcado
    de datos no basta para atacar los hashes—, el mínimo de 12 caracteres, el
    bloqueo temporal y el límite por IP.
  - **Coste medido:** unos 5 ms de CPU por acceso. En el plan gratuito de
    Workers el tope es de 10 ms por petición, así que el acceso va justo; si un
    despliegue devuelve el error 1102 (límite de CPU), la salida es el plan de
    pago o bajar la cifra, **nunca subirla**.
- Sesiones **opacas** con caducidad y revocación. Solo se guarda el **hash** del
  token; nunca el token en claro.
- Limitación de intentos y bloqueo temporal por cuenta/IP.
- Cierre de sesión que revoca el servidor.

## Sesiones y API

- Cookies `HttpOnly`, `Secure` en producción y `SameSite` apropiado.
- Protección **CSRF** en toda operación con estado.
- Validación de entrada con **Zod** en el servidor; no se confía en el cliente.
- SQL siempre **parametrizado** (sin concatenación).
- Protección frente a XSS, IDOR e inyección SQL.
- Autorización por permiso comprobada en el servidor en cada endpoint: ocultar
  un botón no es control de acceso.
- **CSP** y cabeceras de seguridad por defecto (`secureHeaders`).
- Límite de tamaño de solicitud; límites específicos para subidas.
- CORS restrictivo; con API y SPA en el mismo origen no hay CORS.

## Roles y permisos

Roles iniciales configurables: administrador, responsable de inventario,
responsable de asignaciones, editor del sitio y usuario de consulta. Los permisos
son granulares y se comprueban en el servidor. Los apartados nuevos traen los
suyos: `persons.import` (importar fichas), `applicants.read` y
`applicants.write` (revisar y gestionar postulaciones). No se reutiliza
`persons.read` para las postulaciones, de modo que consultar fichas de personal
no da acceso a los datos de quienes postulan.

## Datos personales

- **Postulaciones.** El formulario público es el único endpoint anónimo con
  estado. Se protege con comprobación de mismo origen, límite por hash de IP,
  campo trampa y topes de longitud. La respuesta es siempre la misma para no
  revelar si se guardó o se descartó por duplicada. Se guarda el **hash** de la
  IP, nunca la IP en claro, y el consentimiento con marca de tiempo. La
  conversión en ficha de integrante es una acción explícita y auditada.
- **Importación.** Las planillas se leen en el navegador del operador. El
  staging es transitorio y la limpieza diaria lo purga.
- **Fotos.** No forman parte de la importación ni del formulario de postulación.

## Notificaciones

- El token del bot de Telegram se guarda **cifrado** (AES-256-GCM, clave
  derivada de `AUTH_SESSION_SECRET`) y la API nunca lo devuelve. Los errores de
  la API de Telegram se redactan antes de guardarlos o mostrarlos.
- El aviso llega a un **tercero** (un grupo de Telegram). Por eso, por defecto,
  solo lleva nombre, comuna y un enlace al panel; incluir teléfono y correo es
  una decisión explícita del administrador.
- Los mensajes se envían como texto plano: sin `parse_mode`, los datos del
  público no pueden inyectar formato ni enlaces.
- Un fallo de notificación no altera la operación que lo originó.

## Archivos

- R2 **privado por defecto** (sin `r2.dev` público).
- Validación real del contenido de las imágenes, dimensiones y tamaño; no solo
  la extensión.
- Nombres aleatorios; sin rutas adivinables.
- Autorización en cada descarga privada.
- Publicación **explícita** para imágenes institucionales.
- Limpieza controlada de archivos no referenciados.

## Auditoría

Se registran accesos y fallos de autenticación, cambios de usuarios y permisos,
cambios de inventario, entregas/devoluciones/traslados/bajas, cambios
institucionales, publicación/retirada de contenido, importaciones,
postulaciones (envío, cambio de estado, contacto, conversión) y configuración de
notificaciones. **No** se registran contraseñas, tokens ni datos personales
innecesarios.

## Integridad

Toda variación de existencias pasa por servicios de negocio con `UPDATE`
condicionales, `batch()` atómico e idempotencia. Ver `docs/ARCHITECTURE.md`.

## Cadena de suministro

Las dependencias se fijan en `package-lock.json`. Las *agent skills* de diseño
usadas durante el desarrollo (ui-ux-pro-max, taste-skill, impeccable) se instalan
por máquina, **no** se vendorizan en el repositorio, y su telemetría está
desactivada (`DO_NOT_TRACK=1`, `"telemetry": false`). Solo se commitean sus
artefactos de diseño (`PRODUCT.md`, `DESIGN.md`, `design-system/…`).
