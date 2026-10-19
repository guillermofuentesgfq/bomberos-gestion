/**
 * Pantalla de importación masiva.
 *
 * El archivo se lee en el navegador (SheetJS bajo demanda) y se envía a la API
 * por lotes de 200 filas. La pantalla guía el flujo en cuatro pasos: elegir el
 * tipo y la plantilla, subir el archivo, revisar el análisis y confirmar.
 *
 * El commit es **idempotente por clave natural** (el código del material, el
 * RUT de la persona): reimportar el mismo archivo no duplica nada.
 *
 * Las fotos no se importan; se avisa de ello en la propia pantalla.
 */

import { useRef, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { cx } from '../lib/cx';
import { errorMessage } from './adminApi';
import { parseSpreadsheet, type RowKeyMap } from './importParse';
import {
  createImportBatch,
  downloadFile,
  fetchImportBatch,
  finalizeImportBatch,
  importReportPath,
  importTemplatePath,
  sendImportRows,
  type BatchDetail,
  type ImportKind,
  type ImportMode,
} from './importApi';
import { StatusMessage } from './adminFields';

const MATERIAL_KEYS: RowKeyMap = {
  codigo: 'code',
  nombre: 'name',
  categoria: 'category',
  tipo: 'materialType',
  marca: 'brand',
  modelo: 'model',
  notas: 'notes',
  stock_minimo: 'minStock',
  es_individual: 'isIndividual',
  ubicacion: 'location',
  condicion: 'condition',
  cantidad: 'quantity',
};

const PERSON_KEYS: RowKeyMap = {
  nombre_completo: 'fullName',
  rut: 'rut',
  calidad: 'quality',
  cargo: 'position',
  telefono: 'phone',
  correo: 'email',
  direccion: 'address',
  fecha_nacimiento: 'birthDate',
  fecha_ingreso: 'joinDate',
  n_registro: 'registryNo',
  contacto_emergencia_nombre: 'emergencyName',
  contacto_emergencia_telefono: 'emergencyPhone',
  notas: 'history',
  activo: 'isActive',
};

/** Filas por petición. Se mantiene por debajo del tope del servidor y del
 * límite de 1 MB por cuerpo JSON: con 100 filas, ni un archivo lleno de notas
 * largas lo roza. */
const CHUNK_SIZE = 100;

type Phase = 'idle' | 'parsing' | 'uploading' | 'review' | 'committing' | 'done';

const KIND_LABELS: Record<ImportKind, string> = {
  material: 'Material y existencias',
  person: 'Personas',
};

export function ImportPage({ csrfToken, permissions }: { csrfToken: string; permissions: string[] }) {
  const available: ImportKind[] = [];
  if (permissions.includes('inventory.import')) available.push('material');
  if (permissions.includes('persons.import')) available.push('person');

  const [kind, setKind] = useState<ImportKind>(available[0] ?? 'material');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; stockRows: number } | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (available.length === 0) {
    return (
      <>
        <PageHeader title="Importar datos" />
        <Alert tone="warning">Tu cuenta no tiene permiso para importar materiales ni personas.</Alert>
      </>
    );
  }

  function reset(): void {
    setPhase('idle');
    setProgress({ sent: 0, total: 0 });
    setDetail(null);
    setResult(null);
    setBatchId(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setResult(null);
    setDetail(null);
    setPhase('parsing');
    try {
      const keys = kind === 'material' ? MATERIAL_KEYS : PERSON_KEYS;
      const parsed = await parseSpreadsheet(file, keys);
      if (parsed.rows.length === 0) {
        throw new Error('El archivo no tiene filas de datos. Revisa que la primera fila sean los encabezados.');
      }
      if (parsed.missing.length > 0) {
        throw new Error(
          `Faltan columnas obligatorias en el archivo: ${parsed.missing.join(', ')}. Descarga la plantilla y vuelve a intentarlo.`,
        );
      }

      const created = await createImportBatch(kind, file.name, csrfToken);
      setBatchId(created.id);
      setPhase('uploading');
      setProgress({ sent: 0, total: parsed.rows.length });

      for (let i = 0; i < parsed.rows.length; i += CHUNK_SIZE) {
        const chunk = parsed.rows.slice(i, i + CHUNK_SIZE);
        await sendImportRows(created.id, chunk, csrfToken);
        setProgress({ sent: Math.min(i + CHUNK_SIZE, parsed.rows.length), total: parsed.rows.length });
      }

      const summary = await fetchImportBatch(created.id);
      setDetail(summary);
      setPhase('review');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : errorMessage(caught));
      setPhase('idle');
    }
  }

  async function handleFinalize(mode: ImportMode): Promise<void> {
    if (batchId === null) return;
    setError(null);
    setPhase('committing');
    try {
      const outcome = await finalizeImportBatch(batchId, mode, csrfToken);
      setResult(outcome);
      setPhase('done');
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase('review');
    }
  }

  async function handleDownload(path: string, name: string): Promise<void> {
    setError(null);
    try {
      await downloadFile(path, name);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const busy = phase === 'parsing' || phase === 'uploading' || phase === 'committing';

  return (
    <>
      <PageHeader
        title="Importar datos"
        description="Carga materiales con sus existencias o fichas de personal desde una planilla Excel o CSV. Primero se analiza el archivo y luego decides qué importar."
      />

      {available.length > 1 ? (
        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Tipo de importación">
          {available.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              disabled={busy || phase === 'review' || phase === 'done'}
              onClick={() => {
                setKind(option);
                reset();
              }}
              className={cx(
                'min-h-11 cursor-pointer rounded-lg border-2 px-4 py-2 text-base font-semibold transition-colors',
                kind === option
                  ? 'border-accent bg-accent/10 text-accent-strong'
                  : 'border-line bg-surface text-ink-muted hover:text-ink',
              )}
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mt-6">
          <Alert tone="error" title="No se pudo completar">
            {error}
          </Alert>
        </div>
      ) : null}

      {/* Paso 1: plantilla */}
      <Card className="mt-6">
        <h2 className="text-xl font-bold text-ink">1. Descarga la plantilla</h2>
        <p className="mt-2 max-w-[70ch] text-base text-ink-muted">
          La plantilla incluye los encabezados, los catálogos de tu instalación y las
          instrucciones. Rellénala sin cambiar los nombres de las columnas.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => handleDownload(importTemplatePath(kind, 'xlsx'), `plantilla-${kind}.xlsx`)}
          >
            Plantilla Excel (.xlsx)
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => handleDownload(importTemplatePath(kind, 'csv'), `plantilla-${kind}.csv`)}
          >
            Plantilla CSV
          </Button>
        </div>
      </Card>

      {/* Paso 2: archivo */}
      <Card className="mt-4">
        <h2 className="text-xl font-bold text-ink">2. Sube el archivo</h2>
        <p className="mt-2 max-w-[70ch] text-base text-ink-muted">
          Formatos admitidos: <code>.xlsx</code>, <code>.xls</code> y <code>.csv</code>. Las
          <strong> fotos no se importan</strong>: se suben después, una a una, desde cada ficha.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy || phase === 'review'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="block w-full cursor-pointer rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:font-semibold file:text-brand"
          />
          {phase === 'parsing' ? <StatusMessage busy>Leyendo el archivo…</StatusMessage> : null}
          {phase === 'uploading' ? (
            <StatusMessage busy>
              Analizando filas… {progress.sent} de {progress.total}
            </StatusMessage>
          ) : null}
        </div>
      </Card>

      {/* Paso 3: revisión */}
      {detail ? (
        <Card className="mt-4">
          <h2 className="text-xl font-bold text-ink">3. Revisa el análisis</h2>
          <p className="mt-2 text-base text-ink-muted">
            {detail.batch.filename ? `Archivo: ${detail.batch.filename}. ` : ''}
            {detail.batch.total} fila(s): {detail.batch.valid} válida(s), {detail.batch.errors} con
            error, {detail.batch.warnings} con advertencia.
          </p>

          {detail.issues.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th className="py-2 pr-4 font-semibold">Severidad</th>
                    <th className="py-2 pr-4 font-semibold">Columna</th>
                    <th className="py-2 pr-4 font-semibold">Filas</th>
                    <th className="py-2 font-semibold">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.issues.map((issue) => (
                    <tr key={`${issue.code}-${issue.column}`} className="border-b border-line/60 align-top">
                      <td className="py-2 pr-4">
                        <span
                          className={cx(
                            'rounded-md px-2 py-0.5 text-xs font-semibold',
                            issue.severity === 'error'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-amber-500/15 text-amber-700',
                          )}
                        >
                          {issue.severity === 'error' ? 'Error' : 'Aviso'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-ink-muted">{issue.column}</td>
                      <td className="py-2 pr-4 text-ink">{issue.count}</td>
                      <td className="py-2 text-ink">{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-base text-ink">No se encontraron problemas en el archivo.</p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                handleDownload(importReportPath(detail.batch.id), `informe-importacion-${detail.batch.id}.xlsx`)
              }
            >
              Descargar informe de errores
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Paso 4: confirmar */}
      {detail && phase !== 'done' ? (
        <Card className="mt-4">
          <h2 className="text-xl font-bold text-ink">4. Confirma la importación</h2>
          <p className="mt-2 max-w-[70ch] text-base text-ink-muted">
            «Todo o nada» solo importa si no hay ningún error. «Solo filas válidas» importa lo
            correcto y deja constancia de lo omitido en el informe.
          </p>
          {detail.batch.errors > 0 ? (
            <div className="mt-3">
              <Alert tone="warning">
                Este archivo tiene {detail.batch.errors} fila(s) con error, así que «todo o nada» no
                está disponible.
              </Alert>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={busy || detail.batch.errors > 0 || detail.batch.valid === 0}
              onClick={() => handleFinalize('all_or_nothing')}
              loading={phase === 'committing'}
            >
              Importar todo o nada
            </Button>
            <Button
              variant="secondary"
              disabled={busy || detail.batch.valid === 0}
              onClick={() => handleFinalize('valid_only')}
              loading={phase === 'committing'}
            >
              Importar solo las filas válidas
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Resultado */}
      {phase === 'done' && result ? (
        <Card className="mt-4">
          <h2 className="text-xl font-bold text-ink">Importación terminada</h2>
          <p className="mt-2 text-base text-ink">
            {result.imported} registro(s) importado(s)
            {result.stockRows > 0 ? `, ${result.stockRows} movimiento(s) de existencias` : ''}
            {result.skipped > 0 ? `, ${result.skipped} fila(s) omitida(s)` : ''}.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {detail ? (
              <Button
                variant="secondary"
                onClick={() =>
                  handleDownload(importReportPath(detail.batch.id), `informe-importacion-${detail.batch.id}.xlsx`)
                }
              >
                Descargar informe
              </Button>
            ) : null}
            <Button onClick={reset}>Importar otro archivo</Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}
