-- ---------------------------------------------------------------------------
-- 0003 — Índices de correlación para operaciones atómicas
--
-- `batch_id` agrupa una entrega multi-línea y debe ser único: es la clave por la
-- que las líneas de asignación localizan su cabecera dentro de la misma
-- transacción `batch()` (D1 no permite leer el id recién insertado y usarlo en
-- sentencias posteriores del mismo lote de forma portable).
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignments_batch ON assignments(batch_id);
