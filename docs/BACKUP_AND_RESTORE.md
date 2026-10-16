# Respaldo y restauración

Cada instalación es responsable de sus propios datos. Este documento describe
cómo respaldarlos y cómo restaurarlos.

Los datos viven en dos sitios:

1. **D1** — la base de datos de la institución.
2. **R2** — las imágenes y archivos adjuntos.

Un respaldo completo cubre **ambos**.

## Respaldo de D1

### Exportar a un fichero SQL

```bash
npx wrangler d1 export bomberos-gestion --remote --output respaldo-$(date +%F).sql
```

Guarda el fichero en un lugar seguro y fuera del repositorio. Esto captura el
esquema y los datos.

### Recuperación a un punto en el tiempo (Time Travel)

D1 conserva un historial de cambios recuperable (hasta 30 días en el plan de
pago y 7 días en el gratuito). Consulta los marcadores con:

```bash
npx wrangler d1 time-travel info bomberos-gestion
```

y restaura a un marcador concreto:

```bash
npx wrangler d1 time-travel restore bomberos-gestion --timestamp=<marcador>
```

Time Travel es una red de seguridad ante errores recientes, **no** sustituye a
un respaldo periódico fuera de Cloudflare.

## Respaldo de R2

Sincroniza el bucket a una copia local con `rclone` u otra herramienta
compatible con S3 (R2 expone una API compatible con S3). El egreso de R2 es
gratuito, así que descargar el bucket no tiene coste de transferencia.

```bash
# Ejemplo con rclone (configura un remoto R2 compatible con S3)
rclone sync r2:bomberos-gestion-files ./respaldo-files
```

## Restauración de D1

Sobre una base existente:

```bash
npx wrangler d1 execute bomberos-gestion --remote --file=respaldo.sql
```

> **Nunca** sobrescribas datos existentes sin un respaldo previo y confirmación
> explícita. Si la base ya tiene datos, revisa el fichero antes de aplicarlo.

## Restauración de R2

```bash
rclone sync ./respaldo-files r2:bomberos-gestion-files
```

## Recomendaciones

- Programa un respaldo periódico y guárdalo fuera de Cloudflare.
- Guarda junto al respaldo la fecha y la versión del sistema.
- Prueba la restauración de vez en cuando: un respaldo que no se restaura no es
  un respaldo.
- No commitees nunca un respaldo: contiene datos de la institución.
