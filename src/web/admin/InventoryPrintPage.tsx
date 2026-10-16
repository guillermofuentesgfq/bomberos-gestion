/**
 * Inventario general imprimible.
 *
 * Documento de página completa que se renderiza **fuera** del `AdminLayout`,
 * igual que las actas. El membrete (logotipo o escudo, nombre y datos de la
 * compañía) se dibuja en el `<thead>` de una tabla envolvente para que el
 * navegador lo repita en cada página impresa; el título, las tablas y el pie
 * viajan en el único `<tbody>`. El PDF lo produce el navegador desde el diálogo
 * de impresión; aquí no se genera ningún archivo.
 */

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { formatDate } from '../lib/format';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { StatusMessage } from './adminFields';
import { errorMessage, fetchInventoryReport } from './adminApi';
import type {
  InventoryPrintDetail,
  InventoryPrintInstitution,
  InventoryPrintReport,
  InventoryPrintTotals,
} from './adminApi';

/** `true` cuando el texto existe y no es solo espacios. */
function isNotBlank(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Une los tramos no vacíos con un separador, en el orden dado. */
function joinParts(parts: Array<string | null | undefined>, separator: string): string {
  return parts
    .filter(isNotBlank)
    .map((part) => part.trim())
    .join(separator);
}

/** Dirección compuesta de la institución, sin los tramos vacíos. */
function institutionAddress(institution: InventoryPrintInstitution): string {
  return joinParts(
    [institution.address, institution.commune, institution.region, institution.country],
    ', ',
  );
}

/** Teléfono de emergencia y teléfonos generales, sin repetir el de emergencia. */
function institutionPhones(institution: InventoryPrintInstitution): string {
  const emergency = institution.emergencyNumber.trim();
  const others = institution.phones
    .map((phone) => phone.trim())
    .filter((phone) => phone.length > 0 && phone !== emergency);
  const parts: string[] = [];
  if (emergency) parts.push(`Emergencia ${emergency}`);
  if (others.length > 0) parts.push(`Tel. ${others.join(' / ')}`);
  return parts.join(' · ');
}

/**
 * Marca del membrete: el logotipo si existe, si no el escudo; `null` si no hay
 * ninguno. Se sirve con sesión desde `/api/v1/files/:id`.
 */
function institutionMark(
  institution: InventoryPrintInstitution,
): { src: string; alt: string } | null {
  if (institution.logoObjectId !== null) {
    return {
      src: `/api/v1/files/${institution.logoObjectId}`,
      alt: `Logotipo de ${institution.name}`,
    };
  }
  if (institution.shieldObjectId !== null) {
    return {
      src: `/api/v1/files/${institution.shieldObjectId}`,
      alt: `Escudo de ${institution.name}`,
    };
  }
  return null;
}

/** Membrete que encabeza cada página impresa. */
function DocumentHeader({ institution }: { institution: InventoryPrintInstitution }) {
  const mark = institutionMark(institution);
  const address = institutionAddress(institution);
  const phones = institutionPhones(institution);

  return (
    <div className="inventory-member flex items-start gap-4 border-b-2 border-ink pb-4">
      {mark ? (
        <img
          src={mark.src}
          alt={mark.alt}
          className="h-16 w-16 shrink-0 object-contain"
        />
      ) : null}
      <div className="flex flex-col">
        {isNotBlank(institution.name) ? (
          <p className="text-lg font-bold text-ink">{institution.name}</p>
        ) : null}
        {isNotBlank(institution.number) ? (
          <p className="text-sm text-ink">{institution.number}</p>
        ) : null}
        {address ? <p className="text-sm text-ink-muted">{address}</p> : null}
        {phones ? <p className="text-sm text-ink-muted">{phones}</p> : null}
      </div>
    </div>
  );
}

/** Totales por material, con la miniatura del material cuando existe. */
function TotalsTable({ rows }: { rows: readonly InventoryPrintTotals[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-base text-ink-muted">Sin materiales registrados.</p>;
  }

  return (
    <table className="inventory-table mt-3 w-full border-collapse text-left text-sm">
      <caption className="sr-only">Totales por material</caption>
      <thead>
        <tr className="border-b-2 border-ink">
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Código
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Material
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Categoría
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Tipo
          </th>
          <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
            Total
          </th>
          <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
            Disponible
          </th>
          <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
            No disponible
          </th>
          <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
            Stock mínimo
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Estado
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-line align-top">
            <td className="px-2 py-2 tabular-nums text-ink">{row.code}</td>
            <td className="px-2 py-2 text-ink">
              <span className="flex items-center gap-2">
                {row.photoObjectId !== null ? (
                  <img
                    src={`/api/v1/files/${row.photoObjectId}`}
                    alt={`Foto de ${row.name}`}
                    className="h-11 w-11 shrink-0 rounded border border-line object-cover"
                  />
                ) : null}
                <span>{row.name}</span>
              </span>
            </td>
            <td className="px-2 py-2 text-ink">{row.category || '—'}</td>
            <td className="px-2 py-2 text-ink">{row.type || '—'}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink">{row.total}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink">{row.available}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink">{row.unavailable}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink">{row.minStock}</td>
            <td className="px-2 py-2 text-ink">
              {row.belowMinStock ? (
                <span className="font-semibold text-destructive">Bajo mínimo</span>
              ) : (
                <span className="text-ink-muted">Normal</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Desglose de existencias por ubicación y condición. */
function DetailTable({ rows }: { rows: readonly InventoryPrintDetail[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-base text-ink-muted">Sin desglose por ubicación registrado.</p>;
  }

  return (
    <table className="inventory-table mt-3 w-full border-collapse text-left text-sm">
      <caption className="sr-only">Desglose por ubicación</caption>
      <thead>
        <tr className="border-b-2 border-ink">
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Código
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Material
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Ubicación
          </th>
          <th scope="col" className="px-2 py-2 font-bold text-ink">
            Condición
          </th>
          <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
            Cantidad
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.code}-${row.location}-${index}`} className="border-b border-line align-top">
            <td className="px-2 py-2 tabular-nums text-ink">{row.code}</td>
            <td className="px-2 py-2 text-ink">{row.name}</td>
            <td className="px-2 py-2 text-ink">{row.location}</td>
            <td className="px-2 py-2 text-ink">{row.condition}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink">{row.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InventoryDocument({ data }: { data: InventoryPrintReport }) {
  const { institution, generatedAt, totals, detail } = data;
  const generated = formatDate(generatedAt) ?? generatedAt;
  const grandTotal = totals.reduce((sum, row) => sum + row.total, 0);
  const grandUnavailable = totals.reduce((sum, row) => sum + row.unavailable, 0);

  return (
    <article className="inventory-document rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm sm:p-10">
      <table className="inventory-sheet w-full border-collapse">
        <thead>
          <tr>
            <td className="p-0">
              <DocumentHeader institution={institution} />
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="p-0">
              <h1 className="mt-6 text-center text-xl font-bold tracking-wide text-ink uppercase">
                Inventario general
              </h1>
              <p className="mt-1 text-center text-sm text-ink-muted">Generado el {generated}</p>

              <section className="mt-6">
                <h2 className="mb-2 text-base font-bold text-ink">Totales por material</h2>
                <TotalsTable rows={totals} />
              </section>

              <section className="mt-6">
                <h2 className="mb-2 text-base font-bold text-ink">Desglose por ubicación</h2>
                <DetailTable rows={detail} />
              </section>

              <div className="mt-6 border-t-2 border-ink pt-4">
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                  <div className="flex items-baseline gap-2">
                    <dt className="text-sm font-semibold text-ink-muted">Total de unidades</dt>
                    <dd className="text-base font-bold tabular-nums text-ink">{grandTotal}</dd>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <dt className="text-sm font-semibold text-ink-muted">
                      Unidades no disponibles
                    </dt>
                    <dd className="text-base font-bold tabular-nums text-ink">{grandUnavailable}</dd>
                  </div>
                </dl>

                <div className="inventory-signature mt-16 flex w-64 flex-col items-center">
                  <div className="w-full border-t border-ink" />
                  <p className="mt-1 text-sm font-semibold text-ink">Responsable</p>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

export function InventoryPrintPage(): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const state = useAsync<InventoryPrintReport>(
    (signal) => fetchInventoryReport(signal),
    [reloadToken],
  );

  return (
    <main id="contenido" className="inventory-page min-h-dvh bg-muted px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/admin/informes"
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
          >
            Volver
          </Link>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>

        {state.status === 'loading' ? (
          <StatusMessage busy>Cargando el inventario…</StatusMessage>
        ) : null}

        {state.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <Alert tone="error" title="No se pudo cargar el inventario">
              {errorMessage(state.error)}
            </Alert>
            <div>
              <Button variant="secondary" onClick={reload}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {state.status === 'ready' && state.data ? <InventoryDocument data={state.data} /> : null}
      </div>
    </main>
  );
}
