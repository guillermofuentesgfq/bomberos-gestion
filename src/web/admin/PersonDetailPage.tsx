/**
 * Ficha de una persona: datos, historial de cargos, material asignado con
 * devolución parcial por línea y entrega de material en una o varias líneas.
 *
 * Todas las operaciones se envían con `X-CSRF-Token`, deshabilitan el botón
 * mientras están en curso y recargan la ficha al terminar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { formatDate } from '../lib/format';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { SelectField, StatusMessage, TextAreaField } from './adminFields';
import type { SelectOption } from './adminFields';
import { useForm } from './useForm';
import {
  createAssignment,
  createPosition,
  createReturn,
  errorMessage,
  fetchInventoryCatalog,
  fetchMaterials,
  fetchPersonDetail,
  fetchPersonsCatalog,
} from './adminApi';
import type {
  AssignmentLineInput,
  CreatePositionInput,
  InventoryCatalog,
  MaterialSummary,
  PersonAssignmentLine,
  PersonDetail,
  PersonsCatalog,
  ReturnLineInput,
} from './adminApi';

/** Convierte un valor de input a entero, o `null` si está vacío/no es número. */
function toInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function locationOptions(catalog: InventoryCatalog): SelectOption[] {
  return catalog.locations.map((location) => ({ value: String(location.id), label: location.name }));
}

function conditionOptions(catalog: InventoryCatalog): SelectOption[] {
  return catalog.conditions.map((condition) => ({ value: condition.code, label: condition.name }));
}

function conditionName(catalog: InventoryCatalog, code: string | null): string {
  if (!code) return '—';
  return catalog.conditions.find((condition) => condition.code === code)?.name ?? code;
}

function positionLabel(positions: PersonsCatalog | null, position: { position_type_id: number | null; position_label: string | null }): string {
  if (position.position_type_id !== null) {
    const found = positions?.positionTypes.find((type) => type.id === position.position_type_id);
    return found?.name ?? `Cargo #${position.position_type_id}`;
  }
  return position.position_label ?? '—';
}

// ---------------------------------------------------------------------------
// Alta de cargo
// ---------------------------------------------------------------------------

interface PositionFormValues {
  positionTypeId: string;
  positionLabel: string;
  startDate: string;
  endDate: string;
  notes: string;
}

function PositionForm({
  csrfToken,
  personId,
  catalog,
  onDone,
}: {
  csrfToken: string;
  personId: number;
  catalog: PersonsCatalog;
  onDone: (message: string) => void;
}) {
  const form = useForm<PositionFormValues>({
    positionTypeId: '',
    positionLabel: '',
    startDate: '',
    endDate: '',
    notes: '',
  });

  const types = catalog.positionTypes.map((type) => ({ value: String(type.id), label: type.name }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const positionTypeId = form.values.positionTypeId ? Number(form.values.positionTypeId) : null;
    const label = form.values.positionLabel.trim();

    if (positionTypeId === null && !label) {
      form.setFieldErrors({
        positionTypeId: 'Selecciona un cargo del catálogo o escribe una etiqueta libre.',
      });
      return;
    }

    const input: CreatePositionInput = {};
    if (positionTypeId !== null) input.positionTypeId = positionTypeId;
    if (label) input.positionLabel = label;
    if (form.values.startDate.trim()) input.startDate = form.values.startDate.trim();
    if (form.values.endDate.trim()) input.endDate = form.values.endDate.trim();
    if (form.values.notes.trim()) input.notes = form.values.notes.trim();

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      await createPosition(csrfToken, personId, input);
      form.reset({ positionTypeId: '', positionLabel: '', startDate: '', endDate: '', notes: '' });
      onDone('Cargo agregado al historial.');
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <h3 className="text-lg font-bold text-ink">Agregar cargo</h3>

      {form.generalError ? (
        <div ref={form.errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo agregar el cargo">
            {form.generalError}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label="Cargo del catálogo"
          options={types}
          placeholder="Sin cargo del catálogo"
          value={form.values.positionTypeId}
          error={form.fieldErrors.positionTypeId}
          onChange={(event) => form.patch({ positionTypeId: event.target.value })}
        />
        <TextField
          label="Etiqueta libre"
          hint="Alternativa al catálogo si el cargo no está listado."
          value={form.values.positionLabel}
          error={form.fieldErrors.positionLabel}
          onChange={(event) => form.patch({ positionLabel: event.target.value })}
        />
        <TextField
          label="Desde"
          type="date"
          value={form.values.startDate}
          error={form.fieldErrors.startDate}
          onChange={(event) => form.patch({ startDate: event.target.value })}
        />
        <TextField
          label="Hasta"
          type="date"
          hint="Opcional. Déjalo vacío si el cargo está vigente."
          value={form.values.endDate}
          error={form.fieldErrors.endDate}
          onChange={(event) => form.patch({ endDate: event.target.value })}
        />
      </div>

      <TextAreaField
        label="Notas"
        hint="Opcional."
        value={form.values.notes}
        onChange={(event) => form.patch({ notes: event.target.value })}
      />

      <div>
        <Button type="submit" loading={form.submitting}>
          {form.submitting ? 'Guardando…' : 'Agregar cargo'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Devolución parcial
// ---------------------------------------------------------------------------

interface ReturnFormValues {
  receivedBy: string;
  toLocationId: string;
  conditionCode: string;
  notes: string;
}

function ReturnForm({
  csrfToken,
  personId,
  lines,
  catalog,
  onDone,
  onCancel,
}: {
  csrfToken: string;
  personId: number;
  lines: PersonAssignmentLine[];
  catalog: InventoryCatalog;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<ReturnFormValues>({
    receivedBy: '',
    toLocationId: '',
    conditionCode: 'operativo',
    notes: '',
  });
  const [quantities, setQuantities] = useState<Record<number, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const receivedBy = form.values.receivedBy.trim();
    const toLocationId = toInt(form.values.toLocationId);

    const errors: Record<string, string> = {};
    if (!receivedBy) errors.receivedBy = 'Indica quién recibe el material.';
    if (toLocationId === null) errors.toLocationId = 'Selecciona la ubicación de destino.';

    const returnLines: ReturnLineInput[] = [];
    for (const line of lines) {
      const quantity = toInt(quantities[line.id] ?? '');
      if (quantity === null || quantity === 0) continue;
      const pending = line.quantity - line.returned_qty;
      if (quantity < 0) {
        errors[`line.${line.id}`] = 'La cantidad no puede ser negativa.';
      } else if (quantity > pending) {
        errors[`line.${line.id}`] = `Solo quedan ${pending} pendientes.`;
      } else {
        returnLines.push({ assignmentLineId: line.id, quantity });
      }
    }

    if (Object.keys(errors).length === 0 && returnLines.length === 0) {
      errors.lines = 'Indica al menos una cantidad a devolver.';
    }

    if (Object.keys(errors).length > 0 || receivedBy === '' || toLocationId === null) {
      form.setFieldErrors(errors);
      return;
    }

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      const result = await createReturn(csrfToken, personId, {
        receivedBy,
        toLocationId,
        conditionCode: form.values.conditionCode,
        lines: returnLines,
        ...(form.values.notes.trim() ? { notes: form.values.notes.trim() } : {}),
      });
      setQuantities({});
      form.reset({ receivedBy: '', toLocationId: '', conditionCode: 'operativo', notes: '' });
      onDone(`Devolución N° ${result.returnId} registrada (${result.lines} línea/s).`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <h3 className="text-lg font-bold text-ink">Registrar devolución</h3>

      {form.generalError ? (
        <div ref={form.errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo registrar la devolución">
            {form.generalError}
          </Alert>
        </div>
      ) : null}

      {form.fieldErrors.lines ? (
        <Alert tone="error" title="Revisa la devolución">
          {form.fieldErrors.lines}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TextField
          label="Recibido por"
          required
          value={form.values.receivedBy}
          error={form.fieldErrors.receivedBy}
          onChange={(event) => form.patch({ receivedBy: event.target.value })}
        />
        <SelectField
          label="Ubicación de destino"
          required
          options={locationOptions(catalog)}
          placeholder="Selecciona una ubicación"
          value={form.values.toLocationId}
          error={form.fieldErrors.toLocationId}
          onChange={(event) => form.patch({ toLocationId: event.target.value })}
        />
        <SelectField
          label="Condición de ingreso"
          options={conditionOptions(catalog)}
          value={form.values.conditionCode}
          onChange={(event) => form.patch({ conditionCode: event.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">
          Cantidades a devolver por línea
        </legend>
        <ul className="flex flex-col gap-3">
          {lines.map((line) => {
            const pending = line.quantity - line.returned_qty;
            const fieldId = `devolucion-${line.id}`;
            return (
              <li
                key={line.id}
                className="flex flex-col gap-3 rounded-lg border border-line bg-muted p-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <p className="text-base font-semibold text-ink">{line.item_name}</p>
                  <p className="text-sm text-ink-muted">
                    {line.code}
                    {line.size ? ` · Talla ${line.size}` : ''}
                    {line.serial ? ` · Serie ${line.serial}` : ''} · Pendiente {pending}
                  </p>
                </div>
                <div className="sm:w-48">
                  <TextField
                    id={fieldId}
                    label="Cantidad"
                    type="number"
                    min="0"
                    max={String(pending)}
                    inputMode="numeric"
                    hint="Déjalo en 0 para no devolver esta línea."
                    value={quantities[line.id] ?? ''}
                    error={form.fieldErrors[`line.${line.id}`]}
                    onChange={(event) =>
                      setQuantities((previous) => ({ ...previous, [line.id]: event.target.value }))
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <TextAreaField
        label="Notas"
        hint="Opcional."
        value={form.values.notes}
        onChange={(event) => form.patch({ notes: event.target.value })}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={form.submitting}>
          {form.submitting ? 'Registrando…' : 'Registrar devolución'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Entrega de material
// ---------------------------------------------------------------------------

interface DraftLine {
  key: number;
  materialId: string;
  locationId: string;
  quantity: string;
  conditionOut: string;
}

interface AssignFormValues {
  deliveredBy: string;
  notes: string;
}

function AssignForm({
  csrfToken,
  personId,
  materials,
  catalog,
  onDone,
  onCancel,
}: {
  csrfToken: string;
  personId: number;
  materials: MaterialSummary[];
  catalog: InventoryCatalog;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<AssignFormValues>({ deliveredBy: '', notes: '' });
  const keyRef = useRef(2);
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 1, materialId: '', locationId: '', quantity: '', conditionOut: '' },
  ]);

  const materialOptions = materials.map((material) => ({
    value: String(material.id),
    label: `${material.code} — ${material.name}`,
  }));
  const locations = locationOptions(catalog);
  const conditions = conditionOptions(catalog);

  function addLine() {
    const key = keyRef.current;
    keyRef.current += 1;
    setLines((previous) => [
      ...previous,
      { key, materialId: '', locationId: '', quantity: '', conditionOut: '' },
    ]);
  }

  function removeLine(key: number) {
    setLines((previous) => previous.filter((line) => line.key !== key));
  }

  function updateLine(key: number, partial: Partial<DraftLine>) {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...partial } : line)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const deliveredBy = form.values.deliveredBy.trim();
    const errors: Record<string, string> = {};
    if (!deliveredBy) errors.deliveredBy = 'Indica quién entrega el material.';

    const builtLines: AssignmentLineInput[] = [];
    lines.forEach((line, index) => {
      const materialId = toInt(line.materialId);
      const locationId = toInt(line.locationId);
      const quantity = toInt(line.quantity);
      if (materialId === null) errors[`lines.${index}.materialId`] = 'Selecciona un material.';
      if (locationId === null) errors[`lines.${index}.locationId`] = 'Selecciona una ubicación.';
      if (quantity === null || quantity < 1) {
        errors[`lines.${index}.quantity`] = 'Cantidad mayor que cero.';
      }
      if (materialId !== null && locationId !== null && quantity !== null && quantity >= 1) {
        builtLines.push({
          materialId,
          locationId,
          quantity,
          ...(line.conditionOut ? { conditionOut: line.conditionOut } : {}),
        });
      }
    });

    if (Object.keys(errors).length > 0 || !deliveredBy) {
      form.setFieldErrors(errors);
      return;
    }

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      const result = await createAssignment(csrfToken, personId, {
        deliveredBy,
        lines: builtLines,
        ...(form.values.notes.trim() ? { notes: form.values.notes.trim() } : {}),
      });
      form.reset({ deliveredBy: '', notes: '' });
      keyRef.current = 2;
      setLines([{ key: 1, materialId: '', locationId: '', quantity: '', conditionOut: '' }]);
      onDone(`Entrega registrada (${result.lines} línea/s).`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <h3 className="text-lg font-bold text-ink">Entregar material</h3>

      {form.generalError ? (
        <div ref={form.errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo registrar la entrega">
            {form.generalError}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label="Entregado por"
          required
          value={form.values.deliveredBy}
          error={form.fieldErrors.deliveredBy}
          onChange={(event) => form.patch({ deliveredBy: event.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">Materiales entregados</legend>
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <li key={line.key} className="flex flex-col gap-3 rounded-lg border border-line bg-muted p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <SelectField
                  label={`Material ${index + 1}`}
                  required
                  options={materialOptions}
                  placeholder="Selecciona un material"
                  value={line.materialId}
                  error={form.fieldErrors[`lines.${index}.materialId`]}
                  onChange={(event) => updateLine(line.key, { materialId: event.target.value })}
                />
                <SelectField
                  label="Ubicación de origen"
                  required
                  options={locations}
                  placeholder="Selecciona una ubicación"
                  value={line.locationId}
                  error={form.fieldErrors[`lines.${index}.locationId`]}
                  onChange={(event) => updateLine(line.key, { locationId: event.target.value })}
                />
                <TextField
                  label="Cantidad"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  required
                  value={line.quantity}
                  error={form.fieldErrors[`lines.${index}.quantity`]}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                />
                <SelectField
                  label="Condición de salida"
                  options={conditions}
                  placeholder="Sin condición"
                  value={line.conditionOut}
                  onChange={(event) => updateLine(line.key, { conditionOut: event.target.value })}
                />
              </div>
              {lines.length > 1 ? (
                <div>
                  <Button variant="secondary" onClick={() => removeLine(line.key)}>
                    Quitar línea
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div>
          <Button variant="secondary" onClick={addLine}>
            Agregar línea
          </Button>
        </div>
      </fieldset>

      <TextAreaField
        label="Notas"
        hint="Opcional."
        value={form.values.notes}
        onChange={(event) => form.patch({ notes: event.target.value })}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={form.submitting}>
          {form.submitting ? 'Entregando…' : 'Registrar entrega'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function PersonDetailPage({
  csrfToken,
  personId,
}: {
  csrfToken: string;
  personId: number;
}) {
  const [reloadToken, setReloadToken] = useState(0);
  const [showReturn, setShowReturn] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice) window.requestAnimationFrame(() => noticeRef.current?.focus());
  }, [notice]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const detailState = useAsync<PersonDetail>(
    (signal) => fetchPersonDetail(personId, signal),
    [personId, reloadToken],
  );
  const personsCatalogState = useAsync<PersonsCatalog>((signal) => fetchPersonsCatalog(signal), []);
  const inventoryState = useAsync<InventoryCatalog>((signal) => fetchInventoryCatalog(signal), []);
  const materialsState = useAsync<MaterialSummary[]>((signal) => fetchMaterials({}, signal), []);

  const handleDone = useCallback(
    (message: string) => {
      setNotice(message);
      setShowReturn(false);
      setShowAssign(false);
      reload();
    },
    [reload],
  );

  const person = detailState.data?.person ?? null;
  const personsCatalog = personsCatalogState.data;
  const inventoryCatalog = inventoryState.data;
  const materials = materialsState.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={person ? person.full_name : 'Ficha de persona'}
        description="Cargos, material asignado y entregas."
        actions={
          <Link
            to="/admin/personas"
            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-4 text-base font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
          >
            Volver al listado
          </Link>
        }
      />

      {notice ? (
        <div ref={noticeRef} tabIndex={-1}>
          <Alert tone="success" title="Operación completada">
            {notice}
          </Alert>
        </div>
      ) : null}

      {detailState.status === 'loading' ? (
        <StatusMessage busy>Cargando la ficha de la persona…</StatusMessage>
      ) : null}

      {detailState.status === 'error' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="error" title="No se pudo cargar la ficha">
            {errorMessage(detailState.error)}
          </Alert>
          <div>
            <Button variant="secondary" onClick={reload}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {detailState.status === 'ready' && detailState.data ? (
        <>
          <Card>
            <h2 className="mb-4 text-xl font-bold text-ink">Datos personales</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">RUT</dt>
                <dd className="text-base text-ink">{detailState.data.person.rut ?? '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Calidad</dt>
                <dd className="text-base text-ink">
                  {detailState.data.person.quality_id !== null
                    ? (personsCatalog?.qualities.find(
                        (quality) => quality.id === detailState.data?.person.quality_id,
                      )?.name ?? `Calidad #${detailState.data.person.quality_id}`)
                    : '—'}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Estado</dt>
                <dd className="text-base text-ink">
                  {detailState.data.person.is_active === 1 ? 'Activa' : 'Inactiva'}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Teléfono</dt>
                <dd className="text-base text-ink">{detailState.data.person.phone ?? '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Correo electrónico</dt>
                <dd className="text-base text-ink">{detailState.data.person.email ?? '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Dirección</dt>
                <dd className="text-base text-ink">{detailState.data.person.address ?? '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Ingreso</dt>
                <dd className="text-base text-ink">
                  {detailState.data.person.join_date ?? '—'}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">N.º de registro</dt>
                <dd className="text-base text-ink">{detailState.data.person.registry_no ?? '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Contacto de emergencia</dt>
                <dd className="text-base text-ink">
                  {detailState.data.person.emergency_name ?? '—'}
                  {detailState.data.person.emergency_phone
                    ? ` · ${detailState.data.person.emergency_phone}`
                    : ''}
                </dd>
              </div>
            </dl>
            {detailState.data.person.history ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-ink-muted">Historial</h3>
                <p className="text-base whitespace-pre-line text-ink">
                  {detailState.data.person.history}
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-4 text-xl font-bold text-ink">Historial de cargos</h2>
            {detailState.data.positions.length === 0 ? (
              <StatusMessage>Sin cargos registrados.</StatusMessage>
            ) : (
              <div className="mb-6 overflow-x-auto">
                <table className="w-full border-collapse text-left text-base">
                  <caption className="sr-only">Cargos de la persona</caption>
                  <thead>
                    <tr className="border-b-2 border-line">
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Cargo
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Desde
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Hasta
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailState.data.positions.map((position) => (
                      <tr key={position.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 text-ink">
                          {positionLabel(personsCatalog, position)}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {position.start_date ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {position.end_date ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{position.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {personsCatalog ? (
              <PositionForm
                csrfToken={csrfToken}
                personId={personId}
                catalog={personsCatalog}
                onDone={handleDone}
              />
            ) : (
              <StatusMessage busy={personsCatalogState.status === 'loading'}>
                {personsCatalogState.status === 'loading'
                  ? 'Cargando catálogo de cargos…'
                  : 'No se pudo cargar el catálogo de cargos.'}
              </StatusMessage>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-ink">Material asignado</h2>
              {detailState.data.assignments.length > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => setShowReturn((value) => !value)}
                >
                  {showReturn ? 'Cerrar devolución' : 'Registrar devolución'}
                </Button>
              ) : null}
            </div>

            {detailState.data.assignments.length === 0 ? (
              <StatusMessage>Sin material pendiente de devolución.</StatusMessage>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-base">
                  <caption className="sr-only">Material pendiente de devolución</caption>
                  <thead>
                    <tr className="border-b-2 border-line">
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Material
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Código
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Talla / serie
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                        Entregado
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                        Devuelto
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                        Pendiente
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Condición de salida
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Entregado el
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold text-ink">
                        Acta
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailState.data.assignments.map((line) => (
                      <tr key={line.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 text-ink">{line.item_name}</td>
                        <td className="px-3 py-2 tabular-nums text-ink">{line.code}</td>
                        <td className="px-3 py-2 text-ink">
                          {line.size ?? '—'}
                          {line.serial ? ` / ${line.serial}` : ''}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {line.quantity}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {line.returned_qty}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {line.quantity - line.returned_qty}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {inventoryCatalog
                            ? conditionName(inventoryCatalog, line.condition_out)
                            : (line.condition_out ?? '—')}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {formatDate(line.delivered_at) ?? line.delivered_at}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/admin/actas/entrega/${personId}/${encodeURIComponent(line.batch_id)}`}
                            aria-label={`Ver acta de entrega de ${line.item_name}`}
                            className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand px-3 text-sm font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand/5"
                          >
                            Acta
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {showReturn ? (
                  inventoryCatalog ? (
                    <div className="mt-6 border-t border-line pt-6">
                      <ReturnForm
                        csrfToken={csrfToken}
                        personId={personId}
                        lines={detailState.data.assignments}
                        catalog={inventoryCatalog}
                        onDone={handleDone}
                        onCancel={() => setShowReturn(false)}
                      />
                    </div>
                  ) : (
                    <div className="mt-6">
                      <StatusMessage busy={inventoryState.status === 'loading'}>
                        {inventoryState.status === 'loading'
                          ? 'Cargando ubicaciones y condiciones…'
                          : 'No se pudo cargar el catálogo de inventario.'}
                      </StatusMessage>
                    </div>
                  )
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-ink">Entregar material</h2>
              <Button onClick={() => setShowAssign((value) => !value)}>
                {showAssign ? 'Cerrar entrega' : 'Nueva entrega'}
              </Button>
            </div>

            {showAssign ? (
              inventoryCatalog ? (
                materialsState.status === 'loading' ? (
                  <StatusMessage busy>Cargando materiales…</StatusMessage>
                ) : materialsState.status === 'error' ? (
                  <Alert tone="error" title="No se pudieron cargar los materiales">
                    {errorMessage(materialsState.error)}
                  </Alert>
                ) : (
                  <AssignForm
                    csrfToken={csrfToken}
                    personId={personId}
                    materials={materials}
                    catalog={inventoryCatalog}
                    onDone={handleDone}
                    onCancel={() => setShowAssign(false)}
                  />
                )
              ) : (
                <StatusMessage busy={inventoryState.status === 'loading'}>
                  {inventoryState.status === 'loading'
                    ? 'Cargando ubicaciones y condiciones…'
                    : 'No se pudo cargar el catálogo de inventario.'}
                </StatusMessage>
              )
            ) : (
              <StatusMessage>
                Abre «Nueva entrega» para registrar uno o varios materiales para esta persona.
              </StatusMessage>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
