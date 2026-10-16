/**
 * Ficha imprimible de un integrante.
 *
 * Documento formal de página completa que se renderiza **fuera** del
 * `AdminLayout`, igual que las actas y el inventario imprimible. Reúne los datos
 * de la persona, sus notas (texto enriquecido ya saneado por el servidor), sus
 * cargos y el material que tiene pendiente de devolución.
 *
 * El membrete (logotipo o escudo, nombre y datos de la institución) se dibuja en
 * el `<thead>` de una tabla envolvente para que el navegador lo repita en cada
 * página impresa; el resto del documento (título, secciones, tablas y firma)
 * viaja en el único `<tbody>`. El PDF lo produce el navegador desde el diálogo
 * de impresión; aquí no se genera ningún archivo.
 */

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { toPlainText } from '../lib/richtext';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { StatusMessage } from './adminFields';
import { errorMessage, fetchPersonFicha } from './adminApi';
import type {
  PersonFicha,
  PersonFichaAssignment,
  PersonFichaData,
  PersonFichaInstitution,
  PersonFichaPosition,
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
function institutionAddress(institution: PersonFichaInstitution): string {
  return joinParts(
    [institution.address, institution.commune, institution.region, institution.country],
    ', ',
  );
}

/** Teléfono de emergencia y teléfonos generales, sin repetir el de emergencia. */
function institutionPhones(institution: PersonFichaInstitution): string {
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
  institution: PersonFichaInstitution,
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

/** Fecha legible, o `null` si no hay una fecha utilizable. */
function dateText(value: string | null): string | null {
  if (!isNotBlank(value)) return null;
  return formatDate(value) ?? value;
}

/** La ficha no existe (o el identificador es inválido), a diferencia de un fallo. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'not_found' || error.status === 404);
}

/** Membrete que encabeza cada página impresa. */
function DocumentHeader({ institution }: { institution: PersonFichaInstitution }) {
  const mark = institutionMark(institution);
  const address = institutionAddress(institution);
  const phones = institutionPhones(institution);

  return (
    <div className="print-member flex items-start gap-4 border-b-2 border-ink pb-4">
      {mark ? (
        <img src={mark.src} alt={mark.alt} className="h-16 w-16 shrink-0 object-contain" />
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

/** Par etiqueta/valor de una lista de definición. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="text-base text-ink">{value}</dd>
    </div>
  );
}

/** Datos personales: identificación, calidad y estado. */
function PersonalSection({ person }: { person: PersonFichaData }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Datos personales</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        <Field label="Nombre" value={person.fullName} />
        {isNotBlank(person.rut) ? <Field label="RUT" value={person.rut} /> : null}
        {isNotBlank(person.registryNo) ? (
          <Field label="N.º de registro" value={person.registryNo} />
        ) : null}
        {isNotBlank(person.qualityName) ? (
          <Field label="Calidad" value={person.qualityName} />
        ) : null}
        <Field label="Estado" value={person.isActive ? 'Activo' : 'Inactivo'} />
      </dl>
    </section>
  );
}

/** Teléfono, correo y dirección, omitiendo los vacíos. */
function ContactSection({ person }: { person: PersonFichaData }) {
  if (!isNotBlank(person.phone) && !isNotBlank(person.email) && !isNotBlank(person.address)) {
    return null;
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Contacto</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {isNotBlank(person.phone) ? <Field label="Teléfono" value={person.phone} /> : null}
        {isNotBlank(person.email) ? (
          <Field label="Correo electrónico" value={person.email} />
        ) : null}
        {isNotBlank(person.address) ? <Field label="Dirección" value={person.address} /> : null}
      </dl>
    </section>
  );
}

/** Fechas de nacimiento e ingreso, omitiendo las vacías. */
function DatesSection({ person }: { person: PersonFichaData }) {
  const birth = dateText(person.birthDate);
  const join = dateText(person.joinDate);
  if (!birth && !join) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Fechas</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {birth ? <Field label="Fecha de nacimiento" value={birth} /> : null}
        {join ? <Field label="Fecha de ingreso" value={join} /> : null}
      </dl>
    </section>
  );
}

/** Contacto de emergencia, omitiendo los vacíos. */
function EmergencySection({ person }: { person: PersonFichaData }) {
  if (!isNotBlank(person.emergencyName) && !isNotBlank(person.emergencyPhone)) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Contacto de emergencia</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {isNotBlank(person.emergencyName) ? (
          <Field label="Nombre" value={person.emergencyName} />
        ) : null}
        {isNotBlank(person.emergencyPhone) ? (
          <Field label="Teléfono" value={person.emergencyPhone} />
        ) : null}
      </dl>
    </section>
  );
}

/**
 * Notas de la persona. El servidor entrega HTML ya saneado, así que se inserta
 * tal cual con la clase `richtext`; el cliente no vuelve a sanear.
 */
function NotesSection({ history }: { history: string | null }) {
  if (toPlainText(history, 1) === null) return null;

  return (
    <section className="print-notes mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Notas</h2>
      <div
        className="richtext text-base text-ink"
        dangerouslySetInnerHTML={{ __html: history ?? '' }}
      />
    </section>
  );
}

/** Cargos de la persona, con su vigencia y observaciones. */
function PositionsSection({ positions }: { positions: readonly PersonFichaPosition[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Cargos</h2>
      {positions.length === 0 ? (
        <p className="text-base text-ink-muted">Sin cargos registrados.</p>
      ) : (
        <table className="print-table w-full border-collapse text-left text-sm">
          <caption className="sr-only">Cargos del integrante</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Cargo
              </th>
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Desde
              </th>
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Hasta
              </th>
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Observaciones
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id} className="border-b border-line align-top">
                <td className="px-2 py-2 text-ink">{position.name}</td>
                <td className="px-2 py-2 text-ink">{dateText(position.startDate) ?? '—'}</td>
                <td className="px-2 py-2 text-ink">{dateText(position.endDate) ?? '—'}</td>
                <td className="px-2 py-2 text-ink">
                  {isNotBlank(position.notes) ? position.notes : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Material asignado pendiente de devolución, con su saldo. */
function AssignmentsSection({
  assignments,
}: {
  assignments: readonly PersonFichaAssignment[];
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">
        Material asignado pendiente de devolución
      </h2>
      {assignments.length === 0 ? (
        <p className="text-base text-ink-muted">Sin material pendiente.</p>
      ) : (
        <table className="print-table w-full border-collapse text-left text-sm">
          <caption className="sr-only">Material pendiente de devolución</caption>
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
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Serie
              </th>
              <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
                Entregado
              </th>
              <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
                Devuelto
              </th>
              <th scope="col" className="px-2 py-2 text-right font-bold text-ink">
                Pendiente
              </th>
              <th scope="col" className="px-2 py-2 font-bold text-ink">
                Condición
              </th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment, index) => (
              <tr
                key={`${assignment.code}-${assignment.serial ?? ''}-${index}`}
                className="border-b border-line align-top"
              >
                <td className="px-2 py-2 tabular-nums text-ink">{assignment.code}</td>
                <td className="px-2 py-2 text-ink">{assignment.itemName}</td>
                <td className="px-2 py-2 text-ink">{assignment.size ?? '—'}</td>
                <td className="px-2 py-2 tabular-nums text-ink">{assignment.serial ?? '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">
                  {assignment.quantity}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">
                  {assignment.returnedQty}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">
                  {assignment.quantity - assignment.returnedQty}
                </td>
                <td className="px-2 py-2 text-ink">
                  {isNotBlank(assignment.conditionName) ? assignment.conditionName : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Documento completo: membrete en el `<thead>`, contenido en el `<tbody>`. */
function FichaDocument({ data }: { data: PersonFicha }) {
  const { institution, person, positions, assignments, generatedAt } = data;
  const generated = formatDate(generatedAt) ?? generatedAt;

  return (
    <article className="print-document rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm sm:p-10">
      <table className="print-sheet w-full border-collapse">
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
                Ficha del integrante
              </h1>

              <PersonalSection person={person} />
              <ContactSection person={person} />
              <DatesSection person={person} />
              <EmergencySection person={person} />
              <NotesSection history={person.history} />
              <PositionsSection positions={positions} />
              <AssignmentsSection assignments={assignments} />

              <footer className="mt-6 border-t-2 border-ink pt-4">
                <p className="text-sm text-ink-muted">Documento emitido el {generated}.</p>
                <div className="print-signature mt-16 flex w-64 flex-col items-center">
                  <div className="w-full border-t border-ink" />
                  <p className="mt-1 text-sm font-semibold text-ink">Firma del integrante</p>
                </div>
              </footer>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

export function PersonFichaPage({ personId }: { personId: number }): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const state = useAsync<PersonFicha>(
    (signal) => fetchPersonFicha(personId, signal),
    [personId, reloadToken],
  );

  return (
    <main id="contenido" className="print-page min-h-dvh bg-muted px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link
            to={`/admin/personas/${personId}`}
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
          >
            Volver
          </Link>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>

        {state.status === 'loading' ? (
          <StatusMessage busy>Cargando la ficha del integrante…</StatusMessage>
        ) : null}

        {state.status === 'error' ? (
          isNotFound(state.error) ? (
            <Alert tone="warning" title="Ficha no encontrada">
              No existe un integrante con ese identificador. Puede que se haya eliminado o que el
              enlace esté incompleto.
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              <Alert tone="error" title="No se pudo cargar la ficha">
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

        {state.status === 'ready' && state.data ? <FichaDocument data={state.data} /> : null}
      </div>
    </main>
  );
}
