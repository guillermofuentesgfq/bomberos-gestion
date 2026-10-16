/**
 * Inventario: búsqueda y filtros, tabla de materiales y operaciones por fila
 * (traslado, baja y detalle). El alta de material incluye ubicación y cantidad
 * inicial opcionales.
 *
 * Cada bloque maneja de forma explícita los estados de carga, vacío y error, y
 * anuncia los cambios con `aria-live` a través de `Alert` y `StatusMessage`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MOVEMENT_TYPE_LABELS } from '../../shared/inventory';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { formatDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { CheckboxField, SelectField, StatusMessage, TextAreaField } from './adminFields';
import type { SelectOption } from './adminFields';
import { useForm } from './useForm';
import {
  createMaterial,
  createTransfer,
  createWriteOff,
  errorMessage,
  fetchInventoryCatalog,
  fetchMaterialDetail,
  fetchMaterials,
} from './adminApi';
import type {
  CreateMaterialInput,
  InventoryCatalog,
  MaterialDetail,
  MaterialSummary,
} from './adminApi';

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

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

function conditionLabel(catalog: InventoryCatalog, code: string): string {
  return catalog.conditions.find((condition) => condition.code === code)?.name ?? code;
}

function movementTypeLabel(type: string): string {
  return (MOVEMENT_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

function brandModel(material: MaterialSummary): string {
  const parts = [material.brand, material.model].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' / ') : '—';
}

// ---------------------------------------------------------------------------
// Alta de material
// ---------------------------------------------------------------------------

interface MaterialFormValues {
  name: string;
  code: string;
  categoryId: string;
  materialTypeId: string;
  brand: string;
  model: string;
  minStock: string;
  isIndividual: boolean;
  locationId: string;
  conditionCode: string;
  quantity: string;
  notes: string;
}

const EMPTY_MATERIAL_FORM: MaterialFormValues = {
  name: '',
  code: '',
  categoryId: '',
  materialTypeId: '',
  brand: '',
  model: '',
  minStock: '',
  isIndividual: false,
  locationId: '',
  conditionCode: 'operativo',
  quantity: '',
  notes: '',
};

function MaterialCreateForm({
  csrfToken,
  catalog,
  onCreated,
  onCancel,
}: {
  csrfToken: string;
  catalog: InventoryCatalog;
  onCreated: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<MaterialFormValues>(EMPTY_MATERIAL_FORM);

  const categories = catalog.categories.map((category) => ({
    value: String(category.id),
    label: category.name,
  }));
  const types = catalog.materialTypes.map((type) => ({
    value: String(type.id),
    label: type.name,
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const name = form.values.name.trim();
    const quantity = toInt(form.values.quantity);
    const locationId = form.values.locationId ? Number(form.values.locationId) : null;

    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Ingresa el nombre del material.';
    if (quantity !== null && quantity < 0) errors.quantity = 'La cantidad no puede ser negativa.';
    if (quantity !== null && quantity > 0 && locationId === null) {
      errors.locationId = 'Indica la ubicación para la cantidad inicial.';
    }
    if (Object.keys(errors).length > 0) {
      form.setFieldErrors(errors);
      return;
    }

    const input: CreateMaterialInput = { name };
    const code = form.values.code.trim();
    if (code) input.code = code;
    if (form.values.categoryId) input.categoryId = Number(form.values.categoryId);
    if (form.values.materialTypeId) input.materialTypeId = Number(form.values.materialTypeId);
    if (form.values.brand.trim()) input.brand = form.values.brand.trim();
    if (form.values.model.trim()) input.model = form.values.model.trim();
    if (form.values.notes.trim()) input.notes = form.values.notes.trim();
    const minStock = toInt(form.values.minStock);
    if (minStock !== null && minStock >= 0) input.minStock = minStock;
    if (form.values.isIndividual) input.isIndividual = true;
    if (locationId !== null) input.locationId = locationId;
    if (locationId !== null && quantity !== null && quantity > 0) {
      input.conditionCode = form.values.conditionCode;
      input.quantity = quantity;
    }

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      const created = await createMaterial(csrfToken, input);
      form.reset(EMPTY_MATERIAL_FORM);
      onCreated(`Material «${created.code}» — ${name} creado correctamente.`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <h2 className="text-xl font-bold text-ink">Agregar material</h2>

        {form.generalError ? (
          <div ref={form.errorRef} tabIndex={-1}>
            <Alert tone="error" title="No se pudo crear el material">
              {form.generalError}
            </Alert>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            label="Nombre"
            required
            value={form.values.name}
            error={form.fieldErrors.name}
            onChange={(event) => form.patch({ name: event.target.value })}
          />
          <TextField
            label="Código"
            hint="Opcional. Si lo dejas vacío, se genera uno automáticamente."
            value={form.values.code}
            error={form.fieldErrors.code}
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => form.patch({ code: event.target.value })}
          />
          <SelectField
            label="Categoría"
            options={categories}
            placeholder="Sin categoría"
            value={form.values.categoryId}
            onChange={(event) => form.patch({ categoryId: event.target.value })}
          />
          <SelectField
            label="Tipo de material"
            options={types}
            placeholder="Sin tipo"
            value={form.values.materialTypeId}
            onChange={(event) => form.patch({ materialTypeId: event.target.value })}
          />
          <TextField
            label="Marca"
            value={form.values.brand}
            onChange={(event) => form.patch({ brand: event.target.value })}
          />
          <TextField
            label="Modelo"
            value={form.values.model}
            onChange={(event) => form.patch({ model: event.target.value })}
          />
          <TextField
            label="Stock mínimo"
            type="number"
            min="0"
            inputMode="numeric"
            hint="Umbral para avisar stock bajo."
            value={form.values.minStock}
            error={form.fieldErrors.minStock}
            onChange={(event) => form.patch({ minStock: event.target.value })}
          />
          <TextField
            label="Cantidad inicial"
            type="number"
            min="0"
            inputMode="numeric"
            hint="Opcional. Requiere una ubicación."
            value={form.values.quantity}
            error={form.fieldErrors.quantity}
            onChange={(event) => form.patch({ quantity: event.target.value })}
          />
          <SelectField
            label="Ubicación"
            options={locationOptions(catalog)}
            placeholder="Selecciona una ubicación"
            value={form.values.locationId}
            error={form.fieldErrors.locationId}
            onChange={(event) => form.patch({ locationId: event.target.value })}
          />
          <SelectField
            label="Condición"
            options={conditionOptions(catalog)}
            value={form.values.conditionCode}
            onChange={(event) => form.patch({ conditionCode: event.target.value })}
          />
        </div>

        <TextAreaField
          label="Notas"
          hint="Opcional. Observaciones internas del material."
          value={form.values.notes}
          onChange={(event) => form.patch({ notes: event.target.value })}
        />

        <CheckboxField
          label="Es un material individual (por unidad)"
          hint="Marca si cada unidad tiene serie o talla propia."
          checked={form.values.isIndividual}
          onChange={(event) => form.patch({ isIndividual: event.target.checked })}
        />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={form.submitting}>
            {form.submitting ? 'Guardando…' : 'Crear material'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Traslado
// ---------------------------------------------------------------------------

interface TransferFormValues {
  fromLocationId: string;
  toLocationId: string;
  conditionCode: string;
  quantity: string;
  responsible: string;
  notes: string;
}

function TransferForm({
  csrfToken,
  material,
  catalog,
  onDone,
  onCancel,
}: {
  csrfToken: string;
  material: MaterialSummary;
  catalog: InventoryCatalog;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<TransferFormValues>({
    fromLocationId: '',
    toLocationId: '',
    conditionCode: 'operativo',
    quantity: '',
    responsible: '',
    notes: '',
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const from = toInt(form.values.fromLocationId);
    const to = toInt(form.values.toLocationId);
    const quantity = toInt(form.values.quantity);

    const errors: Record<string, string> = {};
    if (from === null) errors.fromLocationId = 'Selecciona la ubicación de origen.';
    if (to === null) errors.toLocationId = 'Selecciona la ubicación de destino.';
    if (from !== null && to !== null && from === to) {
      errors.toLocationId = 'El destino debe ser distinto del origen.';
    }
    if (quantity === null || quantity < 1) errors.quantity = 'Indica una cantidad mayor que cero.';

    if (Object.keys(errors).length > 0 || from === null || to === null || quantity === null) {
      form.setFieldErrors(errors);
      return;
    }

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      const result = await createTransfer(csrfToken, {
        materialId: material.id,
        fromLocationId: from,
        toLocationId: to,
        conditionCode: form.values.conditionCode,
        quantity,
        ...(form.values.responsible.trim() ? { responsible: form.values.responsible.trim() } : {}),
        ...(form.values.notes.trim() ? { notes: form.values.notes.trim() } : {}),
      });
      onDone(`Traslado N° ${result.transferId} registrado para «${material.name}».`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {form.generalError ? (
        <div ref={form.errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo registrar el traslado">
            {form.generalError}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label="Desde"
          required
          options={locationOptions(catalog)}
          placeholder="Ubicación de origen"
          value={form.values.fromLocationId}
          error={form.fieldErrors.fromLocationId}
          onChange={(event) => form.patch({ fromLocationId: event.target.value })}
        />
        <SelectField
          label="Hacia"
          required
          options={locationOptions(catalog)}
          placeholder="Ubicación de destino"
          value={form.values.toLocationId}
          error={form.fieldErrors.toLocationId}
          onChange={(event) => form.patch({ toLocationId: event.target.value })}
        />
        <SelectField
          label="Condición"
          options={conditionOptions(catalog)}
          value={form.values.conditionCode}
          onChange={(event) => form.patch({ conditionCode: event.target.value })}
        />
        <TextField
          label="Cantidad"
          type="number"
          min="1"
          inputMode="numeric"
          required
          value={form.values.quantity}
          error={form.fieldErrors.quantity}
          onChange={(event) => form.patch({ quantity: event.target.value })}
        />
        <TextField
          label="Responsable"
          hint="Opcional. Quién traslada el material."
          value={form.values.responsible}
          onChange={(event) => form.patch({ responsible: event.target.value })}
        />
      </div>

      <TextAreaField
        label="Notas"
        hint="Opcional."
        value={form.values.notes}
        onChange={(event) => form.patch({ notes: event.target.value })}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={form.submitting}>
          {form.submitting ? 'Trasladando…' : 'Registrar traslado'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

interface WriteOffFormValues {
  locationId: string;
  conditionCode: string;
  quantity: string;
  reason: string;
  authorizedBy: string;
}

function WriteOffForm({
  csrfToken,
  material,
  catalog,
  onDone,
  onCancel,
}: {
  csrfToken: string;
  material: MaterialSummary;
  catalog: InventoryCatalog;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const form = useForm<WriteOffFormValues>({
    locationId: '',
    conditionCode: 'mal_estado',
    quantity: '',
    reason: '',
    authorizedBy: '',
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const locationId = toInt(form.values.locationId);
    const quantity = toInt(form.values.quantity);
    const reason = form.values.reason.trim();
    const authorizedBy = form.values.authorizedBy.trim();

    const errors: Record<string, string> = {};
    if (locationId === null) errors.locationId = 'Selecciona la ubicación del material.';
    if (quantity === null || quantity < 1) errors.quantity = 'Indica una cantidad mayor que cero.';
    if (reason.length < 5) errors.reason = 'Describe el motivo de la baja (mínimo 5 caracteres).';
    if (!authorizedBy) errors.authorizedBy = 'Indica quién autoriza la baja.';

    if (
      Object.keys(errors).length > 0 ||
      locationId === null ||
      quantity === null ||
      reason.length < 5 ||
      !authorizedBy
    ) {
      form.setFieldErrors(errors);
      return;
    }

    form.setSubmitting(true);
    form.setFieldErrors({});
    try {
      const result = await createWriteOff(csrfToken, {
        materialId: material.id,
        locationId,
        conditionCode: form.values.conditionCode,
        quantity,
        reason,
        authorizedBy,
      });
      onDone(`Baja N° ${result.writeoffId} registrada para «${material.name}».`);
    } catch (error) {
      form.applyError(error);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {form.generalError ? (
        <div ref={form.errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo registrar la baja">
            {form.generalError}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label="Ubicación"
          required
          options={locationOptions(catalog)}
          placeholder="Ubicación del material"
          value={form.values.locationId}
          error={form.fieldErrors.locationId}
          onChange={(event) => form.patch({ locationId: event.target.value })}
        />
        <SelectField
          label="Condición"
          options={conditionOptions(catalog)}
          value={form.values.conditionCode}
          onChange={(event) => form.patch({ conditionCode: event.target.value })}
        />
        <TextField
          label="Cantidad"
          type="number"
          min="1"
          inputMode="numeric"
          required
          value={form.values.quantity}
          error={form.fieldErrors.quantity}
          onChange={(event) => form.patch({ quantity: event.target.value })}
        />
        <TextField
          label="Autorizado por"
          required
          hint="Nombre de quien autoriza la baja."
          value={form.values.authorizedBy}
          error={form.fieldErrors.authorizedBy}
          onChange={(event) => form.patch({ authorizedBy: event.target.value })}
        />
      </div>

      <TextAreaField
        label="Motivo"
        required
        hint="Mínimo 5 caracteres. Queda registrado en la bitácora."
        value={form.values.reason}
        error={form.fieldErrors.reason}
        onChange={(event) => form.patch({ reason: event.target.value })}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" loading={form.submitting}>
          {form.submitting ? 'Registrando baja…' : 'Dar de baja'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detalle del material
// ---------------------------------------------------------------------------

function MaterialDetailPanel({
  materialId,
  catalog,
}: {
  materialId: number;
  catalog: InventoryCatalog;
}) {
  const state = useAsync<MaterialDetail>(
    (signal) => fetchMaterialDetail(materialId, signal),
    [materialId],
  );

  if (state.status === 'loading') {
    return <StatusMessage busy>Cargando detalle del material…</StatusMessage>;
  }

  if (state.status === 'error') {
    return (
      <Alert tone="error" title="No se pudo cargar el detalle">
        {errorMessage(state.error)}
      </Alert>
    );
  }

  if (!state.data) {
    return <StatusMessage>No hay información disponible.</StatusMessage>;
  }

  const { material, stock, movements } = state.data;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div className="flex flex-col">
          <dt className="text-sm font-semibold text-ink-muted">Código</dt>
          <dd className="text-base text-ink">{material.code}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm font-semibold text-ink-muted">Marca</dt>
          <dd className="text-base text-ink">{material.brand ?? '—'}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm font-semibold text-ink-muted">Modelo</dt>
          <dd className="text-base text-ink">{material.model ?? '—'}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm font-semibold text-ink-muted">Stock mínimo</dt>
          <dd className="text-base tabular-nums text-ink">{material.min_stock}</dd>
        </div>
      </dl>

      <section aria-labelledby="detalle-existencias" className="flex flex-col gap-2">
        <h3 id="detalle-existencias" className="text-lg font-bold text-ink">
          Existencias por ubicación
        </h3>
        {stock.length === 0 ? (
          <StatusMessage>Este material no tiene existencias registradas.</StatusMessage>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-base">
              <caption className="sr-only">
                Existencias de {material.name} por ubicación y condición
              </caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Ubicación
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Condición
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                    Cantidad
                  </th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 text-ink">{row.location_name}</td>
                    <td className="px-3 py-2 text-ink">
                      {conditionLabel(catalog, row.condition_code)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="detalle-movimientos" className="flex flex-col gap-2">
        <h3 id="detalle-movimientos" className="text-lg font-bold text-ink">
          Movimientos recientes
        </h3>
        {movements.length === 0 ? (
          <StatusMessage>Sin movimientos registrados para este material.</StatusMessage>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-base">
              <caption className="sr-only">Últimos movimientos de {material.name}</caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Movimiento
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                    Cantidad
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Notas
                  </th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 text-ink">
                      {formatDate(movement.created_at) ?? movement.created_at}
                    </td>
                    <td className="px-3 py-2 text-ink">{movementTypeLabel(movement.movement_type)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {movement.quantity}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{movement.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type RowPanel =
  | { kind: 'transfer'; material: MaterialSummary }
  | { kind: 'writeoff'; material: MaterialSummary }
  | { kind: 'detail'; material: MaterialSummary };

function panelTitle(panel: RowPanel): string {
  if (panel.kind === 'transfer') return 'Trasladar material';
  if (panel.kind === 'writeoff') return 'Dar de baja material';
  return 'Detalle del material';
}

export function InventoryPage({ csrfToken }: { csrfToken: string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [panel, setPanel] = useState<RowPanel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Retrasa la búsqueda para no golpear la API en cada tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (panel) window.requestAnimationFrame(() => panelRef.current?.focus());
  }, [panel]);

  useEffect(() => {
    if (notice) window.requestAnimationFrame(() => noticeRef.current?.focus());
  }, [notice]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const catalogState = useAsync<InventoryCatalog>(
    (signal) => fetchInventoryCatalog(signal),
    [],
  );
  const materialsState = useAsync<MaterialSummary[]>(
    (signal) =>
      fetchMaterials(
        {
          ...(search ? { q: search } : {}),
          ...(locationId ? { locationId: Number(locationId) } : {}),
        },
        signal,
      ),
    [search, locationId, reloadToken],
  );

  const catalog = catalogState.data;
  const materials = materialsState.data ?? [];
  const filtersDisabled = catalogState.status !== 'ready';

  const handleCreated = useCallback(
    (message: string) => {
      setNotice(message);
      setShowCreate(false);
      reload();
    },
    [reload],
  );

  const handlePanelDone = useCallback(
    (message: string) => {
      setNotice(message);
      setPanel(null);
      reload();
    },
    [reload],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventario"
        description="Consulta, traslada, da de baja y agrega los materiales de tu institución."
        actions={
          <Button onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Cerrar formulario' : 'Agregar material'}
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
          <MaterialCreateForm
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
        <form
          role="search"
          className="flex flex-col gap-4 md:flex-row md:items-end"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex-1">
            <TextField
              label="Buscar material"
              type="search"
              placeholder="Nombre, código, marca o modelo"
              hint="El listado se actualiza mientras escribes."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="md:w-72">
            <SelectField
              label="Ubicación"
              options={catalog ? locationOptions(catalog) : []}
              placeholder="Todas las ubicaciones"
              value={locationId}
              disabled={filtersDisabled}
              onChange={(event) => setLocationId(event.target.value)}
            />
          </div>
        </form>
      </Card>

      <section
        aria-labelledby="inventario-listado"
        aria-busy={materialsState.status === 'loading' ? true : undefined}
        className="flex flex-col gap-4"
      >
        <h2 id="inventario-listado" className="text-lg font-bold text-ink">
          Materiales
        </h2>

        {materialsState.status === 'loading' ? (
          <StatusMessage busy>Cargando materiales…</StatusMessage>
        ) : null}

        {materialsState.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <Alert tone="error" title="No se pudieron cargar los materiales">
              {errorMessage(materialsState.error)}
            </Alert>
            <div>
              <Button variant="secondary" onClick={reload}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {materialsState.status === 'ready' && materials.length === 0 ? (
          <StatusMessage>No se encontraron materiales con esos criterios.</StatusMessage>
        ) : null}

        {materialsState.status === 'ready' && materials.length > 0 ? (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full border-collapse text-left text-base">
              <caption className="sr-only">Listado de materiales</caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Código
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Nombre
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Marca / modelo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-bold text-ink">
                    Disponible
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2 font-bold text-ink">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr
                    key={material.id}
                    className="border-b border-line odd:bg-surface even:bg-muted last:border-b-0"
                  >
                    <td className="px-3 py-2 font-semibold tabular-nums text-ink">
                      {material.code}
                    </td>
                    <td className="px-3 py-2 text-ink">{material.name}</td>
                    <td className="px-3 py-2 text-ink-muted">{brandModel(material)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{material.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {material.available}
                    </td>
                    <td className="px-3 py-2">
                      {material.belowMinStock ? (
                        <span className="inline-flex items-center rounded-md border-2 border-destructive bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-ink">
                          Bajo mínimo ({material.minStock})
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">Sobre el mínimo</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          aria-label={`Trasladar ${material.name}`}
                          onClick={() => setPanel({ kind: 'transfer', material })}
                        >
                          Trasladar
                        </Button>
                        <Button
                          variant="danger"
                          aria-label={`Dar de baja ${material.name}`}
                          onClick={() => setPanel({ kind: 'writeoff', material })}
                        >
                          Dar de baja
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Ver detalle de ${material.name}`}
                          onClick={() => setPanel({ kind: 'detail', material })}
                        >
                          Ver detalle
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {panel ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="inventario-panel-titulo"
        >
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col">
                  <h2 id="inventario-panel-titulo" className="text-xl font-bold text-ink">
                    {panelTitle(panel)}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {panel.material.code} — {panel.material.name}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setPanel(null)}>
                  Cerrar
                </Button>
              </div>

              {catalog && panel.kind === 'transfer' ? (
                <TransferForm
                  csrfToken={csrfToken}
                  material={panel.material}
                  catalog={catalog}
                  onDone={handlePanelDone}
                  onCancel={() => setPanel(null)}
                />
              ) : null}

              {catalog && panel.kind === 'writeoff' ? (
                <WriteOffForm
                  csrfToken={csrfToken}
                  material={panel.material}
                  catalog={catalog}
                  onDone={handlePanelDone}
                  onCancel={() => setPanel(null)}
                />
              ) : null}

              {panel.kind === 'detail' ? (
                <MaterialDetailPanel materialId={panel.material.id} catalog={catalog ?? emptyCatalog} />
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** Catálogo vacío para resolver nombres cuando el catálogo no cargó. */
const emptyCatalog: InventoryCatalog = {
  locations: [],
  categories: [],
  materialTypes: [],
  conditions: [],
};
