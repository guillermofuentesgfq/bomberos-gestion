/**
 * Sección Informes.
 *
 * Punto de entrada a los informes de solo lectura: un resumen con los
 * contadores del inventario, el documento imprimible del inventario general y
 * las siete descargas en Excel. Las consultas exigen el permiso `inventory.read`
 * (las descargas, `inventory.export`); si la sesión no alcanza, el servidor
 * responde 403 y la pantalla lo muestra, sin anticipar la comprobación.
 */

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { StatusMessage } from './adminFields';
import { errorMessage, fetchReportSummary } from './adminApi';
import type { ReportSummary } from './adminApi';

/** Enlace con el estilo del botón principal del proyecto. */
const PRIMARY_LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-semibold text-white transition-colors duration-200 ease-out hover:bg-accent-strong';

/** Enlace con el estilo del botón secundario (contorno institucional). */
const SECONDARY_LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5';

/** Métrica del resumen: valor grande y etiqueta en lenguaje llano. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-3xl font-bold tabular-nums text-ink">{value}</span>
      <span className="text-base text-ink-muted">{label}</span>
    </Card>
  );
}

interface DownloadItem {
  href: string;
  label: string;
  description: string;
}

/** Las descargas en Excel que ofrece el servidor como archivo directo. */
const DOWNLOADS: readonly DownloadItem[] = [
  {
    href: '/api/v1/reports/inventory.xlsx',
    label: 'Inventario general',
    description: 'Existencias por material con su total, disponible y stock mínimo.',
  },
  {
    href: '/api/v1/reports/assigned.xlsx',
    label: 'Material asignado',
    description: 'Material entregado al personal y aún pendiente de devolución.',
  },
  {
    href: '/api/v1/reports/movements.xlsx',
    label: 'Movimientos',
    description: 'Entradas, traslados, devoluciones y bajas registradas.',
  },
  {
    href: '/api/v1/reports/writeoffs.xlsx',
    label: 'Bajas',
    description: 'Bajas de material con su motivo y la autorización correspondiente.',
  },
  {
    href: '/api/v1/reports/maintenance.xlsx',
    label: 'Mantenimiento',
    description: 'Material en mantenimiento con su estado actual.',
  },
  {
    href: '/api/v1/reports/personnel.xlsx',
    label: 'Personal',
    description: 'Nómina del personal de la compañía.',
  },
  {
    href: '/api/v1/reports/low-stock.xlsx',
    label: 'Bajo stock mínimo',
    description: 'Materiales que están por debajo del mínimo definido.',
  },
];

export function ReportsPage(): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const state = useAsync<ReportSummary>((signal) => fetchReportSummary(signal), [reloadToken]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Informes"
        description="Consulta el resumen del inventario, abre el inventario general listo para imprimir y descarga los informes en Excel."
      />

      <section aria-labelledby="informes-resumen" className="flex flex-col gap-4">
        <h2 id="informes-resumen" className="text-xl font-bold text-ink">
          Resumen
        </h2>

        {state.status === 'loading' ? (
          <StatusMessage busy>Cargando el resumen…</StatusMessage>
        ) : null}

        {state.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <Alert tone="error" title="No se pudo cargar el resumen">
              {errorMessage(state.error)}
            </Alert>
            <div>
              <Button variant="secondary" onClick={reload}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {state.status === 'ready' && state.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Materiales" value={state.data.materials} />
            <StatCard label="Unidades en stock" value={state.data.units} />
            <StatCard label="Personal activo" value={state.data.activePersonnel} />
            <StatCard label="Unidades asignadas" value={state.data.assignedUnits} />
            <StatCard label="Bajas registradas" value={state.data.writeoffs} />
            <StatCard label="Bajo stock mínimo" value={state.data.lowStock} />
          </div>
        ) : null}
      </section>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-ink">Documento imprimible</h2>
          <p className="max-w-[65ch] text-base text-ink-muted">
            Abre un documento con el membrete de la compañía en cada página, listo para imprimir
            o guardar como PDF.
          </p>
        </div>
        <div>
          <Link to="/admin/informes/inventario" className={PRIMARY_LINK_CLASSES}>
            Inventario general (imprimible)
          </Link>
        </div>
      </Card>

      <section aria-labelledby="informes-descargas" className="flex flex-col gap-4">
        <h2 id="informes-descargas" className="text-xl font-bold text-ink">
          Descargas en Excel
        </h2>
        <ul className="flex flex-col gap-4">
          {DOWNLOADS.map((item) => (
            <li key={item.href}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-col gap-1">
                  <span className="text-base font-semibold text-ink">{item.label}</span>
                  <span className="max-w-[65ch] text-sm text-ink-muted">{item.description}</span>
                </span>
                <a
                  href={item.href}
                  download
                  aria-label={`Descargar ${item.label} en Excel`}
                  className={SECONDARY_LINK_CLASSES}
                >
                  Descargar
                </a>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
