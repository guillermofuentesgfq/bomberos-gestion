# Publicar una versión

Una **versión** es un tag `vX.Y.Z` sobre `main`, verificado por la integración
continua y con su sección cerrada en el `CHANGELOG.md`. Las instalaciones
despliegan versiones, nunca ramas: así siempre se sabe qué está en producción y
actualizar es una decisión, no una consecuencia de un `git pull`.

---

## Qué garantiza una versión

- **Comprobada.** El tag pasa la integración continua: tipos, compilación de
  Worker y SPA, pruebas de integración en el runtime de Workers y presencia de la
  documentación exigida. Un tag que no pase no se publica.
- **Documentada.** El `CHANGELOG.md` describe qué cambió, en la sección de esa
  versión, con su fecha.
- **Migraciones ordenadas.** Las migraciones son acumulativas y van en orden; una
  versión nueva añade migraciones nuevas, nunca reescribe las aplicadas.
- **Inmutable.** Un tag publicado **no se mueve ni se borra**. Si algo salió mal,
  se publica la versión siguiente.

## Convención de versiones

Se sigue [Versionado Semántico](https://semver.org/lang/es/) adaptado a lo que le
importa a una instalación:

| Cambio | Cuándo |
|---|---|
| **MAYOR** (X) | Exige al operador algo que otro despliegue no deshace: retirar o reescribir una migración, cambiar el formato de un respaldo o un paso manual obligatorio antes de actualizar. |
| **MENOR** (Y) | Añade funcionalidad o esquema **aditivo** (tablas, columnas o índices nuevos). Actualizar es traer, migrar y desplegar. |
| **PARCHE** (Z) | Corrige sin tocar el esquema. |

Mientras la versión mayor sea `0`, la interfaz y el modelo pueden cambiar sin
previo aviso; aun así se aplican las mismas reglas para que actualizar no
sorprenda.

## Procedimiento

```bash
git switch main && git pull
```

1. **Cerrar el historial.** En `CHANGELOG.md`, mueve el contenido de
   `## [No publicado]` a una sección nueva con la versión y la fecha, y deja
   `## [No publicado]` vacío:

   ```markdown
   ## [No publicado]

   ## [1.2.0] - 2026-11-30

   ### Añadido
   ...
   ```

2. **Subir la versión** (sin que npm cree el tag por su cuenta):

   ```bash
   npm version 1.2.0 --no-git-tag-version
   ```

3. **Verificar todo**, incluida la propia guarda de publicación:

   ```bash
   npm ci
   npm run typecheck
   npm run test
   npm run docs:check
   npm run release:check v1.2.0     # falla si el tag, la versión o el historial no cuadran
   ```

4. **Confirmar** con un mensaje de versión:

   ```bash
   git add -A
   git commit -m "chore(versión): v1.2.0"
   ```

5. **Etiquetar** con un tag anotado y empujar:

   ```bash
   git tag -a v1.2.0 -m "v1.2.0"
   git push origin main
   git push origin v1.2.0
   ```

6. **Esperar a que la integración continua pase sobre el tag.** El flujo `CI`
   incluye, solo para los tags, la comprobación de publicación: el tag debe
   coincidir con `package.json` y tener su sección en el CHANGELOG.

7. **Crear la publicación en GitHub** con el texto de esa sección del CHANGELOG:

   ```bash
   gh release create v1.2.0 --title "v1.2.0" --notes-file docs/tmp-notes.md
   ```

> El `CHANGELOG` se escribe para quien administra una instalación, no para quien
> programa: qué cambia para él y qué tiene que hacer al actualizar.

## Lo que **no** es una versión

Un `push` a `main` no publica nada. `main` es el trabajo en curso, sin garantía
de que esté verde ni de que el historial esté cerrado. Ninguna instalación
debería fijarse a `main`.

---

## Cómo consumen las versiones las instalaciones

La guía completa está en [`../deploy/README.md`](../deploy/README.md). En
resumen, una instalación:

1. trae el tag (`git fetch upstream --tags`),
2. lo fusiona (`git merge v1.2.0`) — sin conflictos, porque su copia no toca
   ningún archivo del proyecto,
3. empuja su `main` y el tag de la versión,
4. y etiqueta la decisión de desplegar (`git tag deploy/v1.2.0`), que dispara el
   despliegue automático.

Las migraciones pendientes las aplica el propio despliegue, antes de publicar el
código nuevo. El detalle de qué comprobar en cada actualización está en
[`DEPLOYMENT.md`](DEPLOYMENT.md).
