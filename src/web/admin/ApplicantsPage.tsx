/**
 * Postulantes: listado, ficha y gestión interna.
 *
 * El sistema no envía correo, así que el contacto se hace fuera (llamada,
 * WhatsApp, presencial) y aquí solo se registra. `tel:` y `wa.me` son enlaces,
 * no integraciones: el navegador abre la aplicación del sistema.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { cx } from '../lib/cx';
import { Link } from '../lib/router';
import { errorMessage } from './adminApi';
import { SelectField, TextAreaField } from './adminFields';
import { downloadFile } from './importApi';
import {
  addApplicantContact,
  addApplicantNote,
  applicantExportPath,
  APPLICANT_STATUSES,
  archiveApplicant,
  convertApplicant,
  fetchApplicant,
  listApplicants,
  STATUS_LABELS,
  updateApplicantStatus,
  type Applicant,
  type ApplicantDetail,
  type ApplicantStatus,
} from './applicantsApi';

const STATUS_OPTIONS = APPLICANT_STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

function statusTone(status: ApplicantStatus): string {
  switch (status) {
    case 'nuevo':
      return 'bg-accent/10 text-accent-strong';
    case 'en_revision':
    case 'entrevista':
      return 'bg-amber-500/15 text-amber-700';
    case 'contactado':
      return 'bg-brand/10 text-brand';
    case 'aceptado':
      return 'bg-emerald-600/10 text-emerald-700';
    case 'rechazado':
    case 'archivado':
      return 'bg-muted text-ink-muted';
  }
}

/** Enlaces de contacto disponibles sin enviar nada desde el sistema. */
function contactLinks(applicant: Applicant) {
  const links: { label: string; href: string }[] = [];
  if (applicant.phone) {
    const digits = applicant.phone.replace(/[^\d+]/g, '');
    links.push({ label: `Llamar ${applicant.phone}`, href: `tel:${digits}` });
    const wa = digits.replace(/^\+/, '').replace(/^9/, '569').replace(/^56/, '56');
    links.push({ label: 'WhatsApp', href: `https://wa.me/${wa}` });
  }
  if (applicant.email) {
    links.push({ label: `Escribir a ${applicant.email}`, href: `mailto:${applicant.email}` });
  }
  return links;
}

export function ApplicantsPage({
  permissions,
}: {
  csrfToken: string;
  permissions: string[];
}) {
  // El listado es de solo lectura (y la exportación es un GET): no necesita
  // token CSRF ni acciones de escritura.
  void permissions;

  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApplicants({
        status: statusFilter || undefined,
        q: search.trim() || undefined,
      });
      setApplicants(data.applicants);
      setCounts(data.counts);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Postulantes"
        description="Postulaciones recibidas desde el sitio público. El sistema no envía correo: el contacto se hace fuera y se registra aquí."
        actions={
          <Button
            variant="secondary"
            onClick={() => void downloadFile(applicantExportPath(), 'postulantes.xlsx')}
          >
            Exportar a Excel
          </Button>
        }
      />

      {error ? (
        <div className="mt-6">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Buscar"
          type="search"
          placeholder="Nombre, RUT, correo o comuna"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Estado"
          value={statusFilter}
          placeholder="Todos"
          options={STATUS_OPTIONS}
          onChange={(event) => setStatusFilter(event.target.value)}
        />
      </div>

      <Card className="mt-6">
        {loading ? (
          <p role="status" className="text-base text-ink-muted">
            Cargando postulaciones…
          </p>
        ) : applicants.length === 0 ? (
          <p className="text-base text-ink-muted">
            No hay postulaciones que coincidan. Cuando alguien complete el formulario del sitio
            público, aparecerá aquí.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {applicants.map((applicant) => (
              <li key={applicant.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-ink">{applicant.fullName}</span>
                    <span
                      className={cx(
                        'rounded-md px-2 py-0.5 text-xs font-semibold',
                        statusTone(applicant.status),
                      )}
                    >
                      {STATUS_LABELS[applicant.status]}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {[applicant.rut, applicant.commune, applicant.email, applicant.phone]
                      .filter((value) => value && value.length > 0)
                      .join(' · ') || 'Sin datos de contacto'}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Recibida el {new Date(applicant.createdAt).toLocaleDateString('es-CL')}
                  </p>
                </div>
                <Link
                  to={`/admin/postulantes/${applicant.id}`}
                  className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand hover:bg-brand/5"
                >
                  Revisar
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {Object.keys(counts).length > 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {Object.entries(counts)
            .map(([status, count]) => {
              const label = (STATUS_LABELS as Record<string, string>)[status] ?? status;
              return `${label}: ${count}`;
            })
            .join(' · ')}
        </p>
      ) : null}
    </>
  );
}

/**
 * Ficha de un postulante. Es una ruta propia (`/admin/postulantes/:id`) para que
 * el aviso de Telegram pueda enlazarla y para que el botón atrás funcione.
 */
export function ApplicantDetailPage({
  applicantId,
  csrfToken,
  permissions,
}: {
  applicantId: number;
  csrfToken: string;
  permissions: string[];
}) {
  const canWrite = permissions.includes('applicants.write');
  const canCreatePerson = permissions.includes('persons.write');
  const id = applicantId;
  const [detail, setDetail] = useState<ApplicantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [contactChannel, setContactChannel] = useState('telefono');
  const [contactSummary, setContactSummary] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await fetchApplicant(id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <>
        <PageHeader title="Postulante" />
        {error ? <Alert tone="error">{error}</Alert> : <p role="status">Cargando…</p>}
        <div className="mt-4">
          <Link
            to="/admin/postulantes"
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand hover:bg-brand/5"
          >
            Volver al listado
          </Link>
        </div>
      </>
    );
  }

  const { applicant } = detail;

  return (
    <>
      <PageHeader
        title={applicant.fullName}
        description={`Recibida el ${new Date(applicant.createdAt).toLocaleString('es-CL')}`}
        actions={
          <Link
            to="/admin/postulantes"
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand hover:bg-brand/5"
          >
            Volver al listado
          </Link>
        }
      />

      {error ? (
        <div className="mt-6">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-6">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-xl font-bold text-ink">Datos de la postulación</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ['RUT', applicant.rut],
              ['Nacimiento', applicant.birthDate],
              ['Correo', applicant.email],
              ['Teléfono', applicant.phone],
              ['Comuna', applicant.commune],
              ['Dirección', applicant.address],
              ['Disponibilidad', applicant.availability],
              [
                'Consentimiento',
                new Date(applicant.consentAt).toLocaleString('es-CL'),
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
                <dd className="text-base text-ink">{value ?? '—'}</dd>
              </div>
            ))}
          </dl>

          {applicant.motivation ? (
            <div className="mt-4">
              <p className="text-sm font-semibold text-ink-muted">Motivación</p>
              <p className="mt-1 whitespace-pre-wrap text-base text-ink">{applicant.motivation}</p>
            </div>
          ) : null}

          {contactLinks(applicant).length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {contactLinks(applicant).map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand hover:bg-brand/5"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-ink">Estado</h2>
          {canWrite ? (
            <div className="mt-4 flex flex-col gap-3">
              <SelectField
                label="Estado del proceso"
                value={applicant.status}
                options={STATUS_OPTIONS}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () => updateApplicantStatus(applicant.id, event.target.value as ApplicantStatus, csrfToken),
                    'Estado actualizado.',
                  )
                }
              />
              {applicant.personId === null && canCreatePerson ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => convertApplicant(applicant.id, csrfToken),
                      'Se creó la ficha de integrante.',
                    )
                  }
                >
                  Crear ficha de integrante
                </Button>
              ) : applicant.personId !== null ? (
                <p className="text-sm text-ink-muted">
                  Ya tiene ficha de integrante (n.º {applicant.personId}).
                </p>
              ) : null}
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => archiveApplicant(applicant.id, csrfToken), 'Postulación archivada.')}
              >
                Archivar postulación
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-base text-ink">{STATUS_LABELS[applicant.status]}</p>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold text-ink">Bitácora de contacto</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {detail.contacts.length === 0 ? (
              <li className="text-base text-ink-muted">Todavía no se registra contacto.</li>
            ) : (
              detail.contacts.map((contact) => (
                <li key={contact.id} className="rounded-lg border border-line p-3">
                  <p className="text-sm font-semibold text-ink">
                    {contact.channel} · {new Date(contact.contactedAt).toLocaleString('es-CL')}
                  </p>
                  <p className="mt-1 text-base text-ink">{contact.summary}</p>
                </li>
              ))
            )}
          </ul>

          {canWrite ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () =>
                    addApplicantContact(
                      applicant.id,
                      { channel: contactChannel, summary: contactSummary },
                      csrfToken,
                    ).then(() => setContactSummary('')),
                  'Contacto registrado.',
                );
              }}
            >
              <SelectField
                label="Canal"
                value={contactChannel}
                onChange={(event) => setContactChannel(event.target.value)}
                options={[
                  { value: 'telefono', label: 'Teléfono' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'presencial', label: 'Presencial' },
                  { value: 'otro', label: 'Otro' },
                ]}
              />
              <TextAreaField
                label="Resumen del contacto"
                value={contactSummary}
                onChange={(event) => setContactSummary(event.target.value)}
                required
              />
              <Button type="submit" disabled={busy || contactSummary.trim().length === 0}>
                Registrar contacto
              </Button>
            </form>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-ink">Notas internas</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {detail.notes.length === 0 ? (
              <li className="text-base text-ink-muted">Sin notas.</li>
            ) : (
              detail.notes.map((item) => (
                <li key={item.id} className="rounded-lg border border-line p-3">
                  <p className="whitespace-pre-wrap text-base text-ink">{item.body}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(item.createdAt).toLocaleString('es-CL')}
                  </p>
                </li>
              ))
            )}
          </ul>

          {canWrite ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => addApplicantNote(applicant.id, note, csrfToken).then(() => setNote('')),
                  'Nota agregada.',
                );
              }}
            >
              <TextAreaField
                label="Nueva nota"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
              />
              <Button type="submit" disabled={busy || note.trim().length === 0}>
                Agregar nota
              </Button>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
