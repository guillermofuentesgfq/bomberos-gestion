/**
 * Historial de movimientos del inventario.
 *
 * Reutiliza `fetchMovements` y traduce los identificadores de ubicación a
 * nombres legibles con el catálogo.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../components/Alert';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { MOVEMENT_TYPE_LABELS, type MovementType } from '../../shared/inventory';
import { errorMessage, fetchInventoryCatalog, fetchMovements, type Movement } from './adminApi';
import { StatusMessage } from './adminFields';

function typeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type as MovementType] ?? type;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

export function MovementsPage() {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError(null);

    Promise.all([
      fetchMovements(200, controller.signal),
      fetchInventoryCatalog(controller.signal),
    ])
      .then(([movements, catalog]) => {
        setRows(movements);
        const map: Record<number, string> = {};
        for (const location of catalog.locations) map[location.id] = location.name;
        setLocationNames(map);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(errorMessage(cause));
      });

    return () => controller.abort();
  }, [reloadToken]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.code, row.item_name, typeLabel(row.movement_type), row.responsible]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [rows, filter]);

  const place = (id: number | null) => (id === null ? '—' : (locationNames[id] ?? `#${id}`));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Movimientos"
        description="Historial de ingresos, traslados, entregas, devoluciones, bajas y cambios de condición."
      />

      <Card className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">Buscar</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Código, material, tipo o responsable"
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-muted"
          />
        </label>

        {error ? (
          <Alert tone="error" title="No se pudieron cargar los movimientos">
            {error}{' '}
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              className="cursor-pointer font-semibold underline underline-offset-2"
            >
              Reintentar
            </button>
          </Alert>
        ) : null}

        {rows === null && !error ? <StatusMessage>Cargando movimientos…</StatusMessage> : null}

        {rows !== null && filtered.length === 0 ? (
          <StatusMessage>
            {rows.length === 0
              ? 'Todavía no hay movimientos registrados.'
              : 'Ningún movimiento coincide con la búsqueda.'}
          </StatusMessage>
        ) : null}

        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Historial de movimientos del inventario</caption>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Fecha</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Código</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Material</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Cantidad</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Desde</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Hacia</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Responsable</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="px-3 py-2 text-ink tabular-nums">{formatTimestamp(row.created_at)}</td>
                    <td className="px-3 py-2 text-ink">{typeLabel(row.movement_type)}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.code ?? '—'}</td>
                    <td className="px-3 py-2 text-ink">{row.item_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-ink tabular-nums">{row.quantity}</td>
                    <td className="px-3 py-2 text-ink-muted">{place(row.from_location_id)}</td>
                    <td className="px-3 py-2 text-ink-muted">{place(row.to_location_id)}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.responsible ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
