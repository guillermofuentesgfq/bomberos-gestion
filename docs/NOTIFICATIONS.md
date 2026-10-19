# Notificaciones por Telegram

La instalación **no envía correo**. Cualquier aviso interno se publica en un
grupo de Telegram mediante un bot. Hoy existe un evento:

| Evento | Cuándo |
|---|---|
| `applicant.created` | Llega una postulación nueva desde el sitio público. |

## Habilitar el bot

Lo hace quien administra la instalación, **desde Ajustes → Notificaciones**, sin
línea de comandos.

1. **Crea el bot.** En Telegram, habla con [@BotFather](https://t.me/BotFather),
   envía `/newbot` y sigue las instrucciones. BotFather devuelve un **token** con
   la forma `123456789:AAaaBBcc…`.
2. **Crea el grupo** donde quieres los avisos y **agrega el bot** como miembro.
   Un bot no ve los mensajes de un grupo si no está dentro.
3. **Obtén el identificador del grupo.** Reenvía un mensaje del grupo a
   [@userinfobot](https://t.me/userinfobot); el identificador suele empezar por
   `-100`.
4. **Configura.** Pega el token y el identificador en Ajustes → Notificaciones,
   marca «Bot activado» y guarda. Con **«Enviar mensaje de prueba»** compruebas
   que el grupo recibe los avisos.

Cambiar el comportamiento del grupo: si el bot deja de recibir mensajes, revisa
que siga siendo miembro y que el grupo no tenga restringido el envío de
mensajes.

## Qué dice el aviso

Por defecto, el mensaje lleva **solo** lo necesario para poder actuar:

```
Nueva postulación: Ana Pérez
Comuna: Concepción

Quiero servir a la comunidad.

Revisar en el panel: https://<tu-dominio>/admin/postulantes/7
```

El teléfono y el correo **no** se incluyen salvo que se active «Incluir teléfono
y correo del postulante en el aviso». Es una decisión explícita: el grupo de
Telegram es un servicio externo y ese dato es personal.

El mensaje se envía como **texto plano**, sin `parse_mode`: los datos que llegan
del público se publican sin interpretar marcado, así que no se puede inyectar
formato ni enlaces en el grupo.

## Cómo se guarda el token

- Se guarda **cifrado** con **AES-256-GCM**; la clave se deriva por HKDF-SHA256
  de `AUTH_SESSION_SECRET` con un `salt` e `info` propios.
- En la base solo hay `base64(iv || ciphertext || tag)`. Un volcado de datos no
  revela el token.
- La API **nunca** lo devuelve: la lectura informa `hasToken: true`/`false`, no
  el valor.
- El token viaja en la URL de la API de Telegram. Cualquier mensaje de error se
  redacta antes de guardarlo o mostrarlo (`bot123…:AA…` → `bot<token>`).

**Rotar `AUTH_SESSION_SECRET` invalida el token guardado.** No es un fallo: la
aplicación lo detecta y pide volver a pegarlo en Ajustes. Es el precio de no
tener un secreto más que administrar.

## Si Telegram falla

Una notificación que falla **nunca** tumba la operación que la originó. El aviso
se dispara fuera del ciclo de respuesta (la postulación se registra igual) y el
error queda en:

- el bloque «Último error de envío» de Ajustes, y
- el historial de envíos (`notification_log`), con estado y detalle saneado.

Los fallos típicos son «chat no encontrado» (grupo o identificador equivocados) y
«token inválido» (token mal copiado o revocado).

## Añadir un evento nuevo

El servicio es genérico: basta con llamar a `notify()` con un evento y el texto.

```ts
const task = notify(c.env, { event: 'low_stock.detected', text: '…' });
c.executionCtx.waitUntil(task);
```

Reglas que conviene mantener: el mensaje se compone **como texto plano**, no
lleva el token ni secretos, y la promesa se entrega con `waitUntil` para no
retrasar la respuesta al usuario.
