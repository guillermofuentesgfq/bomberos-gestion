/** Tipos y constantes compartidos entre el Worker y la SPA. */

/** Tipos de movimiento registrados en la bitácora. */
export const MOVEMENT_TYPES = [
  'ingreso',
  'ingreso_unidad',
  'identificacion_unidad',
  'cambio_condicion',
  'traslado',
  'asignacion',
  'devolucion',
  'baja',
  'mantenimiento',
  'catastro',
  'ajuste',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  ingreso: 'Ingreso de existencias',
  ingreso_unidad: 'Ingreso de unidad',
  identificacion_unidad: 'Identificación de unidad',
  cambio_condicion: 'Cambio de condición',
  traslado: 'Traslado',
  asignacion: 'Asignación',
  devolucion: 'Devolución',
  baja: 'Baja',
  mantenimiento: 'Mantenimiento',
  catastro: 'Catastro inicial',
  ajuste: 'Ajuste',
};

/** Códigos de condición definidos en la migración de referencia. */
export const CONDITION_CODES = [
  'operativo',
  'observacion',
  'en_reparacion',
  'mal_estado',
  'fuera_de_servicio',
  'dado_de_baja',
] as const;

export type ConditionCode = (typeof CONDITION_CODES)[number];

/** Única condición que permite entregar material. */
export const AVAILABLE_CONDITION: ConditionCode = 'operativo';
