/**
 * Personas: búsqueda, alta y listado del personal de la institución.
 *
 * El alta admite los datos de contacto y de emergencia; el detalle de cada
 * persona se abre en `PersonDetailPage` (`/admin/personas/:id`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { RichTextEditor } from '../components/RichTextEditor';
import { TextField } from '../components/TextField';
import { toPlainText } from '../lib/richtext';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { CheckboxField, SelectField, StatusMessage } from './adminFields';
import { ImageUploader } from './ImageUploader';
import { useForm } from './useForm';
import { createPerson, errorMessage, fetchPersons, fetchPersonsCatalog } from './adminApi';
import type { CreatePersonInput, PersonRow, PersonsCatalog } from './adminApi';

/** Ruta de la ficha de una persona; `App.tsx` debe enrutarla. */
export function personDetailPath(personId: number): string {
  return `/admin/personas/${personId}`;
}

interface PersonFormValues {
  fullName: string;
  rut: string;
  qualityId: string;
  phone: string;
  email: string;
  address: string;
  joinDate: string;
  registryNo: string;
  emergencyName: string;
  emergencyPhone: string;
  history: string;
  photoObjectId: number | null;
  isActive: boolean;
}

const EMPTY_PERSON_FORM: PersonFormValues = {
  fullName: '',
  rut: '',
  qualityId: '',
  phone: '',
  email: '',
  address: '',
  joinDate: '',
  registryNo: '',
  emergencyName: '',
  emergencyPhone: '',
  history: '',
  photoObjectId: null,
  isActive: true,
};

function PersonCreateForm({
  csrfToken,
  catalog,
  onCreated,
  onCancel,
}: {
  csrfToken: string;
  catalog: PersonsCatalog;
  onCreated: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<PersonFormValues>(EMPTY_PERSON_FORM);
  const qualities = catalog.qualities.map((quality) => ({
    value: String(quality.id),
    label: quality.name,
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const fullName = form.values.fullName.trim();
    if (!fullName) {
      form.setFieldErrors({ fullName: 'Ingresa el nombre completo.' });
      return;
    }

    const input: CreatePersonInput = {
      fullName,
      isActive: form.values.isActive,
      photoObjectId: form.values.photoObjectId,
    };
    if (form.values.rut.trim()) input.rut = form.values.rut.trim();
    if (form.values.qualityId) input.qualityId = Number(form.values.qualityId);
    if (form.values.phone.trim()) input.phone = form.values.phone.trim();
    if (form.values.email.trim()) input.email = form.values.email.trim();
    if (form.values.address.trim()) input.address = form.values.address.trim();
    if (form.values.joinDate.trim()) input.joinDate = form.values.joinDate.trim();
    if (form.values.registryNo.trim()) input.registryNo = form.values.registryNo.trim();
    if (form.values.emergencyName.trim()) input.emergencyName = form.values.emergencyName.trim();
    if (form.values.emergencyPhone.trim()) input.emergencyPhone = form.values.emergencyPhone.trim();
    if (toPlainText(form.values.history, 1)) input.history = form.values.history;

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      await createPerson(csrfToken, input);
      form.reset(EMPTY_PERSON_FORM);
      onCreated(`Persona «${fullName}» registrada correctamente.`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <h2 className="text-xl font-bold text-ink">Agregar persona</h2>

        {form.generalError ? (
          <div ref={form.errorRef} tabIndex={-1}>
            <Alert tone="error" title="No se pudo registrar la persona">
              {form.generalError}
            </Alert>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            label="Nombre completo"
            required
            value={form.values.fullName}
            error={form.fieldErrors.fullName}
            onChange={(event) => form.patch({ fullName: event.target.value })}
          />
          <TextField
            label="RUT"
            hint="Opcional."
            value={form.values.rut}
            error={form.fieldErrors.rut}
            onChange={(event) => form.patch({ rut: event.target.value })}
          />
          <SelectField
            label="Calidad"
            options={qualities}
            placeholder="Sin calidad"
            value={form.values.qualityId}
            onChange={(event) => form.patch({ qualityId: event.target.value })}
          />
          <TextField
            label="Teléfono"
            type="tel"
            value={form.values.phone}
            onChange={(event) => form.patch({ phone: event.target.value })}
          />
          <TextField
            label="Correo electrónico"
            type="email"
            value={form.values.email}
            error={form.fieldErrors.email}
            onChange={(event) => form.patch({ email: event.target.value })}
          />
          <TextField
            label="Fecha de ingreso"
            type="date"
            value={form.values.joinDate}
            onChange={(event) => form.patch({ joinDate: event.target.value })}
          />
          <TextField
            label="N.º de registro"
            hint="Opcional."
            value={form.values.registryNo}
            onChange={(event) => form.patch({ registryNo: event.target.value })}
          />
          <TextField
            label="Dirección"
            value={form.values.address}
            onChange={(event) => form.patch({ address: event.target.value })}
          />
          <TextField
            label="Contacto de emergencia"
            value={form.values.emergencyName}
            onChange={(event) => form.patch({ emergencyName: event.target.value })}
          />
          <TextField
            label="Teléfono de emergencia"
            type="tel"
            value={form.values.emergencyPhone}
            onChange={(event) => form.patch({ emergencyPhone: event.target.value })}
          />
        </div>

        <RichTextEditor
          label="Historial"
          hint="Opcional. Antecedentes relevantes de la persona."
          value={form.values.history}
          onChange={(html) => form.patch({ history: toPlainText(html, 1) ? html : '' })}
        />

        <ImageUploader
          csrfToken={csrfToken}
          label="Foto"
          hint="Dato personal: se guarda de forma privada y solo se ve con sesión iniciada (aquí y en la ficha imprimible)."
          value={form.values.photoObjectId}
          onChange={(objectId) => form.patch({ photoObjectId: objectId })}
          isPublic={false}
        />

        <CheckboxField
          label="Persona activa"
          checked={form.values.isActive}
          onChange={(event) => form.patch({ isActive: event.target.checked })}
        />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={form.submitting}>
            {form.submitting ? 'Guardando…' : 'Crear persona'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PersonsPage({ csrfToken }: { csrfToken: string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (notice) window.requestAnimationFrame(() => noticeRef.current?.focus());
  }, [notice]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const catalogState = useAsync<PersonsCatalog>((signal) => fetchPersonsCatalog(signal), []);
  const personsState = useAsync<PersonRow[]>(
    (signal) => fetchPersons(search || undefined, signal),
    [search, reloadToken],
  );

  const catalog = catalogState.data;
  const persons = personsState.data ?? [];

  const handleCreated = useCallback(
    (message: string) => {
      setNotice(message);
      setShowCreate(false);
      reload();
    },
    [reload],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Personas"
        description="Registra y consulta al personal de tu institución."
        actions={
          <Button onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Cerrar formulario' : 'Agregar persona'}
          </Button>
        }
      />

      {notice ? (
        <div ref={noticeRef} tabIndex={-1}>
          <Alert tone="success" title="Operación completada">
            {notice}
          </Alert>
        </div>
      ) : null}

      {catalogState.status === 'error' ? (
        <Alert tone="error" title="No se pudo cargar el catálogo">
          {errorMessage(catalogState.error)}
        </Alert>
      ) : null}

      {showCreate ? (
        catalog ? (
          <PersonCreateForm
            csrfToken={csrfToken}
            catalog={catalog}
            onCreated={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <Card>
            <StatusMessage busy={catalogState.status === 'loading'}>
              {catalogState.status === 'loading'
                ? 'Cargando catálogo para el formulario…'
                : 'No se pudo cargar el catálogo para el formulario.'}
            </StatusMessage>
          </Card>
        )
      ) : null}

      <Card>
        <form role="search" onSubmit={(event) => event.preventDefault()}>
          <TextField
            label="Buscar persona"
            type="search"
            placeholder="Nombre, RUT o teléfono"
            hint="El listado se actualiza mientras escribes."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      </Card>

      <section
        aria-labelledby="personas-listado"
        aria-busy={personsState.status === 'loading' ? true : undefined}
        className="flex flex-col gap-4"
      >
        <h2 id="personas-listado" className="text-lg font-bold text-ink">
          Personas
        </h2>

        {personsState.status === 'loading' ? (
          <StatusMessage busy>Cargando personas…</StatusMessage>
        ) : null}

        {personsState.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <Alert tone="error" title="No se pudieron cargar las personas">
              {errorMessage(personsState.error)}
            </Alert>
            <div>
              <Button variant="secondary" onClick={reload}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {personsState.status === 'ready' && persons.length === 0 ? (
          <StatusMessage>No se encontraron personas con esos criterios.</StatusMessage>
        ) : null}

        {personsState.status === 'ready' && persons.length > 0 ? (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full border-collapse text-left text-base">
              <caption className="sr-only">Listado de personas</caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Nombre
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    RUT
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Teléfono
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Ficha
                  </th>
                </tr>
              </thead>
              <tbody>
                {persons.map((person) => (
                  <tr
                    key={person.id}
                    className="border-b border-line odd:bg-surface even:bg-muted last:border-b-0"
                  >
                    <td className="px-3 py-2 text-ink">{person.full_name}</td>
                    <td className="px-3 py-2 tabular-nums text-ink">{person.rut ?? '—'}</td>
                    <td className="px-3 py-2 text-ink">{person.phone ?? '—'}</td>
                    <td className="px-3 py-2">
                      {person.is_active === 1 ? (
                        <span className="inline-flex items-center rounded-md border-2 border-emerald-700 bg-emerald-600/10 px-2 py-0.5 text-xs font-semibold text-ink">
                          Activa
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">Inactiva</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={personDetailPath(person.id)}
                        aria-label={`Ver ficha de ${person.full_name}`}
                        className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
                      >
                        Ver ficha
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
