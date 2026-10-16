/**
 * Informes que se leen de D1 y se devuelven como filas listas para exportar.
 *
 * Cada función devuelve `{ columns, rows }`: `columns` describe la cabecera y
 * la clave de cada campo; `rows` son registros planos con valores `string`,
 * `number` o `null`. Las rutas los convierten a `.xlsx` con `buildWorkbook`.
 *
 * Reglas: SQL siempre parametrizado (vía `all`), fechas en ISO-8601 y un
 * `LIMIT` acotado para no materializar tablas enteras en memoria.
 */

import { all } from '../lib/db';
import { nowIso } from '../lib/time';

/** Límite máximo de filas por informe. */
export const REPORT_LIMIT = 5000;

export interface ReportColumn {
  key: string;
  header: string;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportTable {
  columns: ReportColumn[];
  rows: ReportRow[];
}

/** Filtro opcional por rango de fechas ISO (inclusivo). */
export interface DateRangeFilter {
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Inventario (existencias por material, ubicación y condición)
// ---------------------------------------------------------------------------

interface InventoryDbRow {
  code: string;
  name: string;
  category: string;
  type: string;
  brand: string;
  model: string;
  location: string;
  condition: string;
  quantity: number;
}

export async function inventoryReport(db: D1Database): Promise<ReportTable> {
  const rows = await all<InventoryDbRow>(
    db,
    `SELECT m.code AS code,
            m.name AS name,
            COALESCE(cat.name, '') AS category,
            COALESCE(mt.name, '') AS type,
            COALESCE(m.brand, '') AS brand,
            COALESCE(m.model, '') AS model,
            COALESCE(l.name, '') AS location,
            COALESCE(mc.name, s.condition_code, '') AS condition,
            COALESCE(s.quantity, 0) AS quantity
       FROM materials m
       LEFT JOIN stock_levels s ON s.material_id = m.id
       LEFT JOIN locations l ON l.id = s.location_id
       LEFT JOIN material_conditions mc ON mc.code = s.condition_code
       LEFT JOIN categories cat ON cat.id = m.category_id
       LEFT JOIN material_types mt ON mt.id = m.material_type_id
      WHERE m.archived_at IS NULL
      ORDER BY m.code, l.name, s.condition_code
      LIMIT ?`,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'code', header: 'Código' },
      { key: 'name', header: 'Material' },
      { key: 'category', header: 'Categoría' },
      { key: 'type', header: 'Tipo' },
      { key: 'brand', header: 'Marca' },
      { key: 'model', header: 'Modelo' },
      { key: 'location', header: 'Ubicación' },
      { key: 'condition', header: 'Condición' },
      { key: 'quantity', header: 'Cantidad' },
    ],
    rows: rows.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      type: row.type,
      brand: row.brand,
      model: row.model,
      location: row.location,
      condition: row.condition,
      quantity: row.quantity,
    })),
  };
}

// ---------------------------------------------------------------------------
// Material asignado (líneas con saldo pendiente)
// ---------------------------------------------------------------------------

interface AssignedDbRow {
  person: string;
  rut: string;
  code: string;
  item_name: string;
  size: string;
  serial: string;
  quantity: number;
  returned: number;
  pending: number;
  delivered_at: string;
}

export async function assignedReport(db: D1Database): Promise<ReportTable> {
  const rows = await all<AssignedDbRow>(
    db,
    `SELECT p.full_name AS person,
            COALESCE(p.rut, '') AS rut,
            al.code AS code,
            al.item_name AS item_name,
            COALESCE(al.size, '') AS size,
            COALESCE(al.serial, '') AS serial,
            al.quantity AS quantity,
            al.returned_qty AS returned,
            (al.quantity - al.returned_qty) AS pending,
            a.delivered_at AS delivered_at
       FROM assignment_lines al
       JOIN assignments a ON a.id = al.assignment_id
       JOIN persons p ON p.id = a.person_id
      WHERE al.returned_qty < al.quantity
      ORDER BY p.full_name, a.delivered_at DESC, al.id
      LIMIT ?`,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'person', header: 'Persona' },
      { key: 'rut', header: 'RUT' },
      { key: 'code', header: 'Código' },
      { key: 'item_name', header: 'Material' },
      { key: 'size', header: 'Talla' },
      { key: 'serial', header: 'Serie' },
      { key: 'quantity', header: 'Entregado' },
      { key: 'returned', header: 'Devuelto' },
      { key: 'pending', header: 'Pendiente' },
      { key: 'delivered_at', header: 'Entregado el' },
    ],
    rows: rows.map((row) => ({
      person: row.person,
      rut: row.rut,
      code: row.code,
      item_name: row.item_name,
      size: row.size,
      serial: row.serial,
      quantity: row.quantity,
      returned: row.returned,
      pending: row.pending,
      delivered_at: row.delivered_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Bitácora de movimientos (con filtro de fechas opcional)
// ---------------------------------------------------------------------------

interface MovementDbRow {
  created_at: string;
  movement_type: string;
  code: string;
  item_name: string;
  quantity: number;
  from_location: string;
  to_location: string;
  person: string;
  responsible: string;
  notes: string;
}

export async function movementsReport(
  db: D1Database,
  filter: DateRangeFilter = {},
): Promise<ReportTable> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.from !== undefined) {
    conditions.push('mv.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    conditions.push('mv.created_at <= ?');
    params.push(filter.to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(REPORT_LIMIT);

  const rows = await all<MovementDbRow>(
    db,
    `SELECT mv.created_at AS created_at,
            mv.movement_type AS movement_type,
            COALESCE(mv.code, '') AS code,
            COALESCE(mv.item_name, '') AS item_name,
            mv.quantity AS quantity,
            COALESCE(fl.name, '') AS from_location,
            COALESCE(tl.name, '') AS to_location,
            COALESCE(p.full_name, '') AS person,
            COALESCE(mv.responsible, '') AS responsible,
            COALESCE(mv.notes, '') AS notes
       FROM movements mv
       LEFT JOIN locations fl ON fl.id = mv.from_location_id
       LEFT JOIN locations tl ON tl.id = mv.to_location_id
       LEFT JOIN persons p ON p.id = mv.person_id
       ${where}
      ORDER BY mv.created_at DESC, mv.id DESC
      LIMIT ?`,
    ...params,
  );

  return {
    columns: [
      { key: 'created_at', header: 'Fecha' },
      { key: 'movement_type', header: 'Tipo' },
      { key: 'code', header: 'Código' },
      { key: 'item_name', header: 'Material' },
      { key: 'quantity', header: 'Cantidad' },
      { key: 'from_location', header: 'Desde' },
      { key: 'to_location', header: 'Hacia' },
      { key: 'person', header: 'Persona' },
      { key: 'responsible', header: 'Responsable' },
      { key: 'notes', header: 'Notas' },
    ],
    rows: rows.map((row) => ({
      created_at: row.created_at,
      movement_type: row.movement_type,
      code: row.code,
      item_name: row.item_name,
      quantity: row.quantity,
      from_location: row.from_location,
      to_location: row.to_location,
      person: row.person,
      responsible: row.responsible,
      notes: row.notes,
    })),
  };
}

// ---------------------------------------------------------------------------
// Bajas
// ---------------------------------------------------------------------------

interface WriteOffDbRow {
  created_at: string;
  code: string;
  item_name: string;
  size: string;
  quantity: number;
  reason: string;
  authorized_by: string;
  prior_condition: string;
  location: string;
}

export async function writeoffsReport(db: D1Database): Promise<ReportTable> {
  const rows = await all<WriteOffDbRow>(
    db,
    `SELECT w.created_at AS created_at,
            COALESCE(w.code, '') AS code,
            COALESCE(w.item_name, '') AS item_name,
            COALESCE(w.size, '') AS size,
            w.quantity AS quantity,
            w.reason AS reason,
            w.authorized_by AS authorized_by,
            COALESCE(w.prior_condition, '') AS prior_condition,
            COALESCE(l.name, '') AS location
       FROM writeoffs w
       LEFT JOIN locations l ON l.id = w.location_id
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT ?`,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'created_at', header: 'Fecha' },
      { key: 'code', header: 'Código' },
      { key: 'item_name', header: 'Material' },
      { key: 'size', header: 'Talla' },
      { key: 'quantity', header: 'Cantidad' },
      { key: 'reason', header: 'Motivo' },
      { key: 'authorized_by', header: 'Autorizado por' },
      { key: 'prior_condition', header: 'Condición previa' },
      { key: 'location', header: 'Ubicación' },
    ],
    rows: rows.map((row) => ({
      created_at: row.created_at,
      code: row.code,
      item_name: row.item_name,
      size: row.size,
      quantity: row.quantity,
      reason: row.reason,
      authorized_by: row.authorized_by,
      prior_condition: row.prior_condition,
      location: row.location,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mantenimiento
// ---------------------------------------------------------------------------

interface MaintenanceDbRow {
  performed_at: string;
  code: string;
  name: string;
  unit: string;
  kind: string;
  result: string;
  resulting_condition: string;
  next_due_at: string;
  responsible: string;
  notes: string;
}

export async function maintenanceReport(db: D1Database): Promise<ReportTable> {
  const rows = await all<MaintenanceDbRow>(
    db,
    `SELECT mr.performed_at AS performed_at,
            m.code AS code,
            m.name AS name,
            COALESCE(u.code, '') AS unit,
            COALESCE(mr.kind, '') AS kind,
            COALESCE(mr.result, '') AS result,
            COALESCE(mc.name, '') AS resulting_condition,
            COALESCE(mr.next_due_at, '') AS next_due_at,
            COALESCE(mr.responsible, '') AS responsible,
            COALESCE(mr.notes, '') AS notes
       FROM maintenance_records mr
       JOIN materials m ON m.id = mr.material_id
       LEFT JOIN material_units u ON u.id = mr.unit_id
       LEFT JOIN material_conditions mc ON mc.code = mr.resulting_condition
      ORDER BY mr.performed_at DESC, mr.id DESC
      LIMIT ?`,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'performed_at', header: 'Realizado el' },
      { key: 'code', header: 'Código' },
      { key: 'name', header: 'Material' },
      { key: 'unit', header: 'Unidad' },
      { key: 'kind', header: 'Tipo' },
      { key: 'result', header: 'Resultado' },
      { key: 'resulting_condition', header: 'Condición resultante' },
      { key: 'next_due_at', header: 'Próximo vencimiento' },
      { key: 'responsible', header: 'Responsable' },
      { key: 'notes', header: 'Notas' },
    ],
    rows: rows.map((row) => ({
      performed_at: row.performed_at,
      code: row.code,
      name: row.name,
      unit: row.unit,
      kind: row.kind,
      result: row.result,
      resulting_condition: row.resulting_condition,
      next_due_at: row.next_due_at,
      responsible: row.responsible,
      notes: row.notes,
    })),
  };
}

// ---------------------------------------------------------------------------
// Personal (con calidad y cargo vigente)
// ---------------------------------------------------------------------------

interface PersonDbRow {
  full_name: string;
  rut: string;
  quality: string;
  position: string;
  phone: string;
  email: string;
  registry_no: string;
  join_date: string;
  is_active: number;
}

export async function personnelReport(db: D1Database): Promise<ReportTable> {
  const today = nowIso().slice(0, 10);
  const rows = await all<PersonDbRow>(
    db,
    `SELECT p.full_name AS full_name,
            COALESCE(p.rut, '') AS rut,
            COALESCE(q.name, '') AS quality,
            COALESCE(pt.name, pp.position_label, '') AS position,
            COALESCE(p.phone, '') AS phone,
            COALESCE(p.email, '') AS email,
            COALESCE(p.registry_no, '') AS registry_no,
            COALESCE(p.join_date, '') AS join_date,
            p.is_active AS is_active
       FROM persons p
       LEFT JOIN qualities q ON q.id = p.quality_id
       LEFT JOIN person_positions pp ON pp.id = (
         SELECT pp2.id FROM person_positions pp2
          WHERE pp2.person_id = p.id AND pp2.archived_at IS NULL
            AND (pp2.end_date IS NULL OR pp2.end_date >= ?)
          ORDER BY COALESCE(pp2.start_date, '') DESC, pp2.id DESC
          LIMIT 1
       )
       LEFT JOIN position_types pt ON pt.id = pp.position_type_id
      WHERE p.archived_at IS NULL
      ORDER BY p.full_name
      LIMIT ?`,
    today,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'full_name', header: 'Nombre' },
      { key: 'rut', header: 'RUT' },
      { key: 'quality', header: 'Calidad' },
      { key: 'position', header: 'Cargo vigente' },
      { key: 'phone', header: 'Teléfono' },
      { key: 'email', header: 'Correo' },
      { key: 'registry_no', header: 'N° registro' },
      { key: 'join_date', header: 'Ingreso' },
      { key: 'status', header: 'Estado' },
    ],
    rows: rows.map((row) => ({
      full_name: row.full_name,
      rut: row.rut,
      quality: row.quality,
      position: row.position,
      phone: row.phone,
      email: row.email,
      registry_no: row.registry_no,
      join_date: row.join_date,
      status: row.is_active === 1 ? 'Activo' : 'Inactivo',
    })),
  };
}

// ---------------------------------------------------------------------------
// Materiales bajo el mínimo
// ---------------------------------------------------------------------------

interface LowStockDbRow {
  code: string;
  name: string;
  category: string;
  min_stock: number;
  total: number;
  deficit: number;
}

export async function lowStockReport(db: D1Database): Promise<ReportTable> {
  const rows = await all<LowStockDbRow>(
    db,
    `SELECT m.code AS code,
            m.name AS name,
            COALESCE(cat.name, '') AS category,
            m.min_stock AS min_stock,
            COALESCE(SUM(s.quantity), 0) AS total,
            (m.min_stock - COALESCE(SUM(s.quantity), 0)) AS deficit
       FROM materials m
       LEFT JOIN categories cat ON cat.id = m.category_id
       LEFT JOIN stock_levels s ON s.material_id = m.id
      WHERE m.archived_at IS NULL
      GROUP BY m.id
     HAVING COALESCE(SUM(s.quantity), 0) < m.min_stock
      ORDER BY deficit DESC, m.name
      LIMIT ?`,
    REPORT_LIMIT,
  );

  return {
    columns: [
      { key: 'code', header: 'Código' },
      { key: 'name', header: 'Material' },
      { key: 'category', header: 'Categoría' },
      { key: 'min_stock', header: 'Mínimo' },
      { key: 'total', header: 'Disponible' },
      { key: 'deficit', header: 'Déficit' },
    ],
    rows: rows.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      min_stock: row.min_stock,
      total: row.total,
      deficit: row.deficit,
    })),
  };
}

// ---------------------------------------------------------------------------
// Inventario imprimible (totales por material y desglose por ubicación)
// ---------------------------------------------------------------------------

export interface InventoryPrintTotals {
  id: number;
  code: string;
  name: string;
  category: string;
  type: string;
  total: number;
  available: number;
  unavailable: number;
  minStock: number;
  belowMinStock: boolean;
  photoObjectId: number | null;
}

export interface InventoryPrintDetail {
  code: string;
  name: string;
  location: string;
  condition: string;
  quantity: number;
}

export interface InventoryPrintReport {
  totals: InventoryPrintTotals[];
  detail: InventoryPrintDetail[];
}

interface InventoryTotalsDbRow {
  id: number;
  code: string;
  name: string;
  category: string;
  type: string;
  total: number;
  available: number;
  min_stock: number;
  photo_object_id: number | null;
}

interface InventoryDetailDbRow {
  code: string;
  name: string;
  location: string;
  cond: string;
  quantity: number;
}

/**
 * Datos del inventario completo para la vista imprimible.
 *
 * `totals` resume cada material (total, disponible, no disponible y mínimo);
 * `detail` da el desglose por ubicación y condición. Van separados porque el
 * documento los presenta en dos tablas: primero el resumen y después dónde
 * está cada cosa.
 */
export async function inventoryPrintReport(db: D1Database): Promise<InventoryPrintReport> {
  const [totals, detail] = await Promise.all([
    all<InventoryTotalsDbRow>(
      db,
      `SELECT m.id AS id,
              m.code AS code,
              m.name AS name,
              COALESCE(cat.name, '') AS category,
              COALESCE(mt.name, '') AS type,
              COALESCE(SUM(s.quantity), 0) AS total,
              COALESCE(SUM(CASE WHEN mc.is_available = 1 THEN s.quantity ELSE 0 END), 0) AS available,
              m.min_stock AS min_stock,
              m.photo_object_id AS photo_object_id
         FROM materials m
         LEFT JOIN stock_levels s ON s.material_id = m.id
         LEFT JOIN material_conditions mc ON mc.code = s.condition_code
         LEFT JOIN categories cat ON cat.id = m.category_id
         LEFT JOIN material_types mt ON mt.id = m.material_type_id
        WHERE m.archived_at IS NULL
        GROUP BY m.id
        ORDER BY m.name, m.code
        LIMIT ?`,
      REPORT_LIMIT,
    ),
    all<InventoryDetailDbRow>(
      db,
      `SELECT m.code AS code,
              m.name AS name,
              COALESCE(l.name, '') AS location,
              COALESCE(mc.name, s.condition_code, '') AS cond,
              COALESCE(s.quantity, 0) AS quantity
         FROM materials m
         JOIN stock_levels s ON s.material_id = m.id
         LEFT JOIN locations l ON l.id = s.location_id
         LEFT JOIN material_conditions mc ON mc.code = s.condition_code
        WHERE m.archived_at IS NULL
        ORDER BY m.name, m.code, l.name, s.condition_code
        LIMIT ?`,
      REPORT_LIMIT,
    ),
  ]);

  return {
    totals: totals.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      type: row.type,
      total: row.total,
      available: row.available,
      unavailable: row.total - row.available,
      minStock: row.min_stock,
      belowMinStock: row.total < row.min_stock,
      photoObjectId: row.photo_object_id,
    })),
    detail: detail.map((row) => ({
      code: row.code,
      name: row.name,
      location: row.location,
      condition: row.cond,
      quantity: row.quantity,
    })),
  };
}
