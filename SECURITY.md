# Seguridad

Este documento describe el modelo de seguridad y cómo reportar vulnerabilidades.

## Reporte de vulnerabilidades

No abras una incidencia pública para un problema de seguridad. Contacta en
privado a los mantenedores del repositorio y da tiempo razonable antes de
divulgarlo. Incluye: descripción, impacto, pasos de reproducción y versión.

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
son granulares y se comprueban en el servidor.

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
institucionales, publicación/retirada de contenido y exportaciones. **No** se
registran contraseñas, tokens ni datos personales innecesarios.

## Integridad

Toda variación de existencias pasa por servicios de negocio con `UPDATE`
condicionales, `batch()` atómico e idempotencia. Ver `docs/ARCHITECTURE.md`.

## Cadena de suministro

Las dependencias se fijan en `package-lock.json`. Las *agent skills* de diseño
usadas durante el desarrollo (ui-ux-pro-max, taste-skill, impeccable) se instalan
por máquina, **no** se vendorizan en el repositorio, y su telemetría está
desactivada (`DO_NOT_TRACK=1`, `"telemetry": false`). Solo se commitean sus
artefactos de diseño (`PRODUCT.md`, `DESIGN.md`, `design-system/…`).
