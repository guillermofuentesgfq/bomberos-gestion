/**
 * Acta de baja de material.
 *
 * Documento imprimible de una baja de inventario ya registrada. Se renderiza
 * **fuera** del `AdminLayout`: la pantalla es el documento completo, con un
 * botón «Imprimir» para que el usuario elija «Guardar como PDF» en el diálogo
 * del navegador. El PDF lo produce el navegador; aquí no se genera ningún
 * archivo.
 */

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { StatusMessage } from './adminFields';
import { errorMessage, fetchActaBaja } from './adminApi';
import type { ActaBaja, ActaInstitution } from './adminApi';

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
function institutionAddress(institution: ActaInstitution): string {
  return joinParts(
    [institution.address, institution.commune, institution.region, institution.country],
    ', ',
  );
}

/** Teléfono de emergencia y teléfonos generales, sin repetir el de emergencia. */
function institutionPhones(institution: ActaInstitution): string {
  const emergency = institution.emergencyNumber.trim();
  const others = institution.phones
    .map((phone) => phone.trim())
    .filter((phone) => phone.length > 0 && phone !== emergency);
  const parts: string[] = [];
  if (emergency) parts.push(`Emergencia ${emergency}`);
  if (others.length > 0) parts.push(`Tel. ${others.join(' / ')}`);
  return parts.join(' · ');
}

/** Escudo institucional servido con sesión, o `null` si no hay. */
function shieldUrl(institution: ActaInstitution): string | null {
  return institution.shieldObjectId !== null
    ? `/api/v1/files/${institution.shieldObjectId}`
    : null;
}

/** El acta no existe (o el enlace está incompleto), a diferencia de un fallo de red. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'not_found' || error.status === 404);
}

function BajaDocument({ data }: { data: ActaBaja }) {
  const { institution, acta } = data;
  const shield = shieldUrl(institution);
  const address = institutionAddress(institution);
  const phones = institutionPhones(institution);
  const createdAt = formatDate(acta.createdAt) ?? acta.createdAt;

  const signatures: Array<{ label: string; name: string | null }> = [
    { label: 'Autoriza', name: acta.authorizedBy },
    { label: 'Testigo', name: null },
  ];

  return (
    <article className="acta-document rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm sm:p-10">
      <div className="mb-4 flex justify-end">
        <p className="text-xs text-ink-muted">Acta N.º {acta.id}</p>
      </div>

      <header className="flex items-start gap-4 border-b-2 border-ink pb-4">
        {shield ? (
          <img
            src={shield}
            alt={`Escudo de ${institution.name}`}
            className="h-20 w-20 shrink-0 object-contain"
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
      </header>

      <h1 className="mt-6 text-center text-xl font-bold tracking-wide text-ink uppercase">
        Acta de baja de material
      </h1>

      <section className="mt-6" aria-labelledby="acta-datos">
        <h2 id="acta-datos" className="mb-2 text-base font-bold text-ink">
          Antecedentes de la baja
        </h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex flex-col">
            <dt className="text-sm font-semibold text-ink-muted">Fecha</dt>
            <dd className="text-base text-ink">{createdAt}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm font-semibold text-ink-muted">Autoriza</dt>
            <dd className="text-base text-ink">{acta.authorizedBy}</dd>
          </div>
          {isNotBlank(acta.locationName) ? (
            <div className="flex flex-col">
              <dt className="text-sm font-semibold text-ink-muted">Ubicación</dt>
              <dd className="text-base text-ink">{acta.locationName}</dd>
            </div>
          ) : null}
          <div className="flex flex-col sm:col-span-2">
            <dt className="text-sm font-semibold text-ink-muted">Motivo</dt>
            <dd className="text-base whitespace-pre-line text-ink">{acta.reason}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6" aria-labelledby="acta-material">
        <h2 id="acta-material" className="mb-2 text-base font-bold text-ink">
          Detalle del material
        </h2>
        {acta.lines.length === 0 ? (
          <p className="text-base text-ink-muted">Esta baja no tiene líneas registradas.</p>
        ) : (
          <table className="acta-table w-full border-collapse text-left text-sm">
            <caption className="sr-only">Material dado de baja</caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="px-2 py-2 font-bold text-ink">
                  Código
                </th>
                <th scope="col" className="px-2 py-2 font-bold text-ink">
                  Material
                </th>
                <th scope="col" className="px-2 py-2 font-bold text-ink">
                  Talla
                </th>
                <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
                  Cantidad
                </th>
                <th scope="col" className="px-2 py-2 font-bold text-ink">
                  Condición
                </th>
              </tr>
            </thead>
            <tbody>
              {acta.lines.map((line, index) => (
                <tr key={`${line.code ?? index}`} className="border-b border-line">
                  <td className="px-2 py-2 tabular-nums text-ink">{line.code ?? '—'}</td>
                  <td className="px-2 py-2 text-ink">{line.itemName ?? '—'}</td>
                  <td className="px-2 py-2 text-ink">{line.size ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{line.quantity}</td>
                  <td className="px-2 py-2 text-ink">
                    {line.priorConditionName ?? line.priorCondition ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="acta-signatures mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2">
        {signatures.map((signature) => (
          <div
            key={signature.label}
            className="acta-signature flex flex-col items-center text-center"
          >
            <p className="text-sm font-semibold text-ink">{signature.label}</p>
            <div className="mt-12 w-full border-t border-ink" />
            <p className="mt-1 min-h-5 text-sm text-ink">{signature.name ?? '\u00A0'}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function ActaBajaPage({ writeoffId }: { writeoffId: number }): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const state = useAsync<ActaBaja>(
    (signal) => fetchActaBaja(writeoffId, signal),
    [writeoffId, reloadToken],
  );

  return (
    <main id="contenido"
      className="acta-page min-h-dvh bg-muted px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/admin/inventario"
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
          >
            Volver
          </Link>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>

        {state.status === 'loading' ? (
          <StatusMessage busy>Cargando el acta de baja…</StatusMessage>
        ) : null}

        {state.status === 'error' ? (
          isNotFound(state.error) ? (
            <Alert tone="warning" title="Acta no encontrada">
              No existe una baja con ese identificador. Puede que se haya eliminado o que el enlace
              esté incompleto.
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              <Alert tone="error" title="No se pudo cargar el acta">
                {errorMessage(state.error)}
              </Alert>
              <div>
                <Button variant="secondary" onClick={reload}>
                  Reintentar
                </Button>
              </div>
            </div>
          )
        ) : null}

        {state.status === 'ready' && state.data ? <BajaDocument data={state.data} /> : null}
      </div>
    </main>
  );
}
