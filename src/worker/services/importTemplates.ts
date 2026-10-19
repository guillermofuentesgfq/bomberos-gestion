/**
 * Plantillas de importación descargables.
 *
 * Se generan al vuelo con `buildWorkbook()` (no hay binarios en el repo) y
 * llevan tres hojas: los datos a rellenar, los catálogos de la instalación
 * (para no inventar nombres) y las instrucciones, que explican las reglas y que
 * **las fotos no se importan**.
 */

import type { SheetSpec } from './xlsx';
import type { ImportKind } from './imports';

/** Encabezados de la hoja de datos. El orden es el contrato de la plantilla. */
export const MATERIAL_HEADERS = [
  'codigo',
  'nombre',
  'categoria',
  'tipo',
  'marca',
  'modelo',
  'notas',
  'stock_minimo',
  'es_individual',
  'ubicacion',
  'condicion',
  'cantidad',
] as const;

export const PERSON_HEADERS = [
  'nombre_completo',
  'rut',
  'calidad',
  'cargo',
  'telefono',
  'correo',
  'direccion',
  'fecha_nacimiento',
  'fecha_ingreso',
  'n_registro',
  'contacto_emergencia_nombre',
  'contacto_emergencia_telefono',
  'notas',
  'activo',
] as const;

export interface TemplateCatalogs {
  categories: string[];
  materialTypes: string[];
  locations: string[];
  conditions: string[];
  qualities: string[];
}

const MATERIAL_INSTRUCTIONS: string[] = [
  'Plantilla de importación de materiales y existencias.',
  '',
  'Una fila por material y ubicación. Si un material tiene existencias en varias',
  'ubicaciones o condiciones, repite el mismo código en varias filas: todas deben',
  'coincidir en nombre, marca y modelo.',
  '',
  'codigo          Obligatorio. Se guarda en mayúsculas y no puede repetirse en la',
  '                instalación. Si el código ya existe, la fila es un error.',
  'nombre          Obligatorio.',
  'categoria       Opcional. Debe existir en el catálogo (ver hoja Catálogos).',
  'tipo            Opcional. Debe existir en el catálogo.',
  'marca, modelo   Opcionales.',
  'notas           Opcional, texto libre.',
  'stock_minimo    Opcional. Entero, por defecto 0.',
  'es_individual   Opcional: sí o no. Un material individual se crea, pero sus',
  '                unidades y series se cargan después desde la ficha.',
  'ubicacion       Obligatoria si hay cantidad. Debe existir en el catálogo.',
  'condicion       Opcional en la práctica: si se omite, se usa «operativo».',
  'cantidad        Obligatoria si hay ubicación. Entero no negativo.',
  '',
  'Las existencias se SUMAN al saldo que ya hubiera en esa ubicación y condición.',
  '',
  'LAS FOTOS NO SE IMPORTAN. Se suben una a una desde la ficha del material,',
  'una vez creado.',
];

const PERSON_INSTRUCTIONS: string[] = [
  'Plantilla de importación de fichas de personal.',
  '',
  'Una fila por persona. No se admiten dos filas con el mismo RUT.',
  '',
  'nombre_completo Obligatorio.',
  'rut             Opcional, pero se valida el dígito verificador. Formato',
  '                12.345.678-9 o 12345678-9.',
  'calidad         Opcional. Debe existir en el catálogo (ver hoja Catálogos).',
  'cargo           Opcional. Si coincide con un cargo del catálogo se usa ese; si',
  '                no, se guarda como etiqueta libre. Requiere RUT válido.',
  'telefono,       Opcionales.',
  'correo,',
  'direccion',
  'fecha_nacimiento Fechas en formato dd/mm/aaaa o aaaa-mm-dd.',
  'fecha_ingreso    Ídem.',
  'n_registro      Opcional.',
  'contacto_emergencia_nombre    Opcionales.',
  'contacto_emergencia_telefono',
  'notas           Opcional, texto libre.',
  'activo          Opcional: sí o no. Por defecto sí.',
  '',
  'LAS FOTOS NO SE IMPORTAN. Se suben una a una desde la ficha de la persona,',
  'una vez creada.',
];

function catalogsSheet(catalogs: TemplateCatalogs): SheetSpec {
  const rows: (string | null)[][] = [['tipo', 'valor']];
  const add = (label: string, values: string[]) => {
    for (const value of values) rows.push([label, value]);
  };
  add('categoria', catalogs.categories);
  add('tipo', catalogs.materialTypes);
  add('ubicacion', catalogs.locations);
  add('condicion', catalogs.conditions);
  add('calidad', catalogs.qualities);
  return { name: 'Catalogos', rows };
}

/** Libro de la plantilla de materiales. */
export function materialTemplate(catalogs: TemplateCatalogs): SheetSpec[] {
  return [
    { name: 'Materiales', rows: [[...MATERIAL_HEADERS]] },
    catalogsSheet(catalogs),
    { name: 'Instrucciones', rows: MATERIAL_INSTRUCTIONS.map((line) => [line]) },
  ];
}

/** Libro de la plantilla de personas. */
export function personTemplate(catalogs: TemplateCatalogs): SheetSpec[] {
  return [
    { name: 'Personas', rows: [[...PERSON_HEADERS]] },
    catalogsSheet(catalogs),
    { name: 'Instrucciones', rows: PERSON_INSTRUCTIONS.map((line) => [line]) },
  ];
}

/**
 * CSV de la plantilla. Va con BOM y separador `;` porque es lo que Excel espera
 * en configuración regional de Chile: sin el BOM, los acentos se rompen.
 */
export function templateCsv(kind: ImportKind): string {
  const headers = kind === 'material' ? MATERIAL_HEADERS : PERSON_HEADERS;
  return `\uFEFF${headers.join(';')}\r\n`;
}
