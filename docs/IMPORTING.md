# Importación de datos

Carga masiva de **materiales con sus existencias** y de **fichas de personal**
desde una planilla. Sustituye a la idea original de importar el volcado SQLite
del sistema anterior: no se lee SQL, se lee una hoja de cálculo.

## Cómo funciona

```
Navegador                                        Worker
─────────                                        ──────
SheetJS (carga bajo demanda)                     Valida cada fila
  ├─ .xlsx / .xls / .csv                         Resuelve nombre → id
  ├─ normaliza fechas, RUT y números             Guarda el staging
  └─ envía lotes de 200 filas  ────────────────► Confirma con SQL set-based
```

El archivo **se lee en el navegador**. El Worker no puede descomprimir y parsear
OOXML con los 10 ms de CPU del plan gratuito ni leer BIFF8 (`.xls` antiguo) sin
una librería pesada. Aquí solo se reciben filas ya normalizadas.

La confirmación no escribe «una sentencia por fila»: lee el staging con
`INSERT … SELECT`. Un archivo de 10 000 filas cuesta media docena de sentencias,
dentro de una transacción atómica. Es lo que permite respetar el tope de **50
consultas por invocación** del plan gratuito de D1.

## Límites

| Límite | Valor |
|---|---|
| Tamaño del archivo | 10 MB |
| Filas por archivo | 20 000 |
| Filas por envío (interno) | 200 |
| Códigos duplicados por archivo | Válidos si describen el mismo material |

En el plan gratuito, cada fila analizada consume escrituras de D1. Para archivos
grandes, conviene partirlos por debajo de 5 000 filas.

## Plantillas

Se generan al vuelo desde el panel (no hay binarios en el repositorio) y llevan
tres hojas: los datos, los **catálogos de la instalación** y las instrucciones.

- `GET /api/v1/imports/templates/material.xlsx` y `.csv`
- `GET /api/v1/imports/templates/person.xlsx` y `.csv`

### Columnas de material

| Columna | Obligatoria | Notas |
|---|---|---|
| `codigo` | Sí | Se guarda en mayúsculas. Único en la instalación. |
| `nombre` | Sí | |
| `categoria` | No | Debe existir en el catálogo. |
| `tipo` | No | Debe existir en el catálogo. |
| `marca`, `modelo` | No | |
| `notas` | No | Texto libre. |
| `stock_minimo` | No | Entero no negativo; por defecto 0. |
| `es_individual` | No | `sí` o `no`. El material se crea; sus unidades se cargan después. |
| `ubicacion` | Si hay cantidad | Debe existir en el catálogo. |
| `condicion` | No | Si se omite, `operativo`. |
| `cantidad` | Si hay ubicación | Entero no negativo. |

Una fila es **un material en una ubicación**: el mismo `codigo` puede repetirse
para repartir existencias entre ubicaciones o condiciones; todas las filas deben
coincidir en nombre, marca y modelo.

### Columnas de persona

| Columna | Obligatoria | Notas |
|---|---|---|
| `nombre_completo` | Sí | |
| `rut` | No | Se valida el dígito verificador. |
| `calidad` | No | Debe existir en el catálogo. |
| `cargo` | No | Si coincide con el catálogo se usa; si no, queda como etiqueta libre. **Exige RUT válido.** |
| `telefono`, `correo`, `direccion` | No | |
| `fecha_nacimiento`, `fecha_ingreso` | No | `dd/mm/aaaa` o `aaaa-mm-dd`. |
| `n_registro` | No | |
| `contacto_emergencia_nombre`, `contacto_emergencia_telefono` | No | |
| `notas` | No | Texto libre. |
| `activo` | No | `sí` o `no`; por defecto `sí`. |

### Fechas y booleanos

- Fechas: `dd/mm/aaaa`, `aaaa-mm-dd` o el número de serie de Excel.
- Booleanos: `sí`, `si`, `x`, `1`, `true` / `no`, `0`, `false`.

## Qué no se importa

- **Fotos.** Ni de materiales ni de personas. Se suben una a una desde la ficha.
- **Unidades individuales** con serie y talla. Un material marcado como
  individual se crea igual, pero sus unidades se agregan desde su ficha.
- **Asignaciones, devoluciones, bajas ni movimientos históricos.** Solo el
  estado actual: material, existencias y personas.

## Errores

Cada fila con problemas guarda una lista de incidencias con `columna`, `codigo`,
`mensaje` y `severidad`. Algunos avisos (**advertencia**) no bloquean la
importación.

| Código | Severidad | Significado |
|---|---|---|
| `required` | Error | Falta un valor obligatorio. |
| `too_long` | Error | El valor supera el largo admitido. |
| `invalid_number` | Error | Se esperaba un entero. |
| `invalid_boolean` | Error | Se esperaba `sí` o `no`. |
| `invalid_date` | Error | La fecha no es interpretable. |
| `invalid_rut` | Error | El dígito verificador no coincide. |
| `invalid_email` | Error | El correo no tiene formato válido. |
| `unknown_category` | Error | La categoría no está en el catálogo. |
| `unknown_material_type` | Error | El tipo no está en el catálogo. |
| `unknown_location` | Error | La ubicación no está en el catálogo. |
| `unknown_condition` | Error | La condición no existe. |
| `unknown_quality` | Error | La calidad no está en el catálogo. |
| `incomplete_stock` | Error | Ubicación sin cantidad, o al revés. |
| `duplicate_existing` | Error | El código o el RUT ya existen en la instalación. |
| `duplicate_in_file` | Error | El RUT aparece dos veces en el archivo. |
| `conflicting_fields` | Error | El mismo código con datos distintos. |
| `position_requires_rut` | Error | Se pidió un cargo sin RUT válido. |
| `individual_without_units` | Advertencia | Unidades y series se cargan después. |
| `duplicate_name_in_file` | Advertencia | Dos personas con el mismo nombre y sin RUT. |

Los códigos se agrupan por causa en la pantalla y el informe completo se descarga
en Excel con `fila`, `columna`, `severidad`, `codigo`, `mensaje` y `valor`.

## Modos de confirmación

- **Todo o nada.** Solo se importa si no hay ninguna fila con error. Es el modo
  por defecto y garantiza una carga coherente.
- **Solo filas válidas.** Importa lo correcto y deja constancia de lo omitido.

La importación es **idempotente por clave natural** (el código del material, el
RUT de la persona): volver a subir el mismo archivo no duplica nada; las filas ya
presentes se reportan como error y se omiten.

## Existencias: se suman, no se pisan

La cantidad de la plantilla se **suma** al saldo que ya hubiera en esa ubicación y
condición, y genera un movimiento de ingreso por cada material y ubicación. Así,
reimportar un archivo nunca borra existencias cargadas después por otros medios.

## Permisos

| Acción | Permiso |
|---|---|
| Importar materiales y descargar sus plantillas | `inventory.import` |
| Importar personas y descargar sus plantillas | `persons.import` |

Cada lote queda ligado a la cuenta que lo creó: otra cuenta no puede continuarlo.
La confirmación escribe una fila de auditoría (`inventory.imported` o
`persons.imported`) con el tipo, el modo y los conteos.
