/**
 * Catálogo del inventario.
 *
 * Sub-sección de Inventario con las ubicaciones, las categorías y los tipos de
 * material que se usan al registrar material. Cada listado permite crear
 * elementos y archivarlos con una confirmación en dos pasos (sin `window.confirm`,
 * igual que el borrado de fotos de la galería). Al final se muestran, en solo
 * lectura, los estados que definen qué existencias cuentan como disponibles.
 */

import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { SelectField, StatusMessage } from './adminFields';
import {
  archiveCategory,
  archiveLocation,
  archiveMaterialType,
  createMaterialType,
  errorMessage,
  fetchInventoryCatalog,
} from './adminApi';
import type { CategoryOption, ConditionOption, InventoryCatalog, LocationOption, MaterialTypeOption } from './adminApi';
import { createCategory, createLocation } from './settingsApi';

interface CatalogEntry {
  id: number;
  name: string;
  meta?: string | undefined;
}

/** Listado con la confirmación en dos pasos para archivar un elemento. */
function CatalogList({
  items,
  emptyMessage,
  noun,
  confirmId,
  archivingId,
  onRequestArchive,
  onCancelArchive,
  onArchive,
}: {
  items: readonly CatalogEntry[];
  emptyMessage: string;
  noun: string;
  confirmId: number | null;
  archivingId: number | null;
  onRequestArchive: (id: number) => void;
  onCancelArchive: () => void;
  onArchive: (id: number, name: string) => void;
}) {
  if (items.length === 0) {
    return <StatusMessage>{emptyMessage}</StatusMessage>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-md border border-line px-3 py-2">
          {confirmId === item.id ? (
            <div className="flex flex-col gap-2">
              <p className="text-base text-ink">
                ¿Archivar {noun} «{item.name}»?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  className="min-h-9 px-3 py-1 text-sm"
                  loading={archivingId === item.id}
                  onClick={() => onArchive(item.id, item.name)}
                >
                  Sí, archivar
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-9 px-3 py-1 text-sm"
                  disabled={archivingId === item.id}
                  onClick={onCancelArchive}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-col">
                <span className="text-base text-ink">{item.name}</span>
                {item.meta !== undefined ? (
                  <span className="text-sm text-ink-muted">{item.meta}</span>
                ) : null}
              </span>
              <Button
                variant="secondary"
                className="min-h-9 px-3 py-1 text-sm"
                disabled={archivingId !== null}
                aria-label={`Archivar ${noun} ${item.name}`}
                onClick={() => onRequestArchive(item.id)}
              >
                Archivar
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function LocationsSection({
  items,
  csrfToken,
  onChanged,
  onNotice,
  onError,
}: {
  items: readonly LocationOption[];
  csrfToken: string;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    onNotice(null);
    try {
      await createLocation(value, null, csrfToken);
      setName('');
      onNotice(`Ubicación «${value}» agregada.`);
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? 'Esa ubicación ya existe.'
          : errorMessage(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleArchive(id: number, value: string) {
    if (archivingId !== null) return;
    setArchivingId(id);
    onError(null);
    onNotice(null);
    try {
      await archiveLocation(id, csrfToken);
      setConfirmId(null);
      onNotice(`Ubicación «${value}» archivada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Ubicaciones</h2>
      <p className="text-base text-ink-muted">
        Sin ubicaciones no se puede registrar ni mover material: créalas antes de cargar el
        inventario.
      </p>

      <CatalogList
        items={items.map((location) => ({ id: location.id, name: location.name }))}
        emptyMessage="Todavía no hay ubicaciones."
        noun="la ubicación"
        confirmId={confirmId}
        archivingId={archivingId}
        onRequestArchive={(id) => setConfirmId(id)}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={(id, value) => void handleArchive(id, value)}
      />

      <form className="flex flex-col gap-3" onSubmit={handleAdd} noValidate>
        <TextField
          label="Nueva ubicación"
          hint="Por ejemplo: Bodega, Sala de estar, BX-2, Taller."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" loading={adding}>
            Agregar ubicación
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CategoriesSection({
  items,
  csrfToken,
  onChanged,
  onNotice,
  onError,
}: {
  items: readonly CategoryOption[];
  csrfToken: string;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    onNotice(null);
    try {
      await createCategory(value, csrfToken);
      setName('');
      onNotice(`Categoría «${value}» agregada.`);
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? 'Esa categoría ya existe.'
          : errorMessage(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleArchive(id: number, value: string) {
    if (archivingId !== null) return;
    setArchivingId(id);
    onError(null);
    onNotice(null);
    try {
      await archiveCategory(id, csrfToken);
      setConfirmId(null);
      onNotice(`Categoría «${value}» archivada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Categorías</h2>
      <p className="text-base text-ink-muted">
        Agrupan los materiales por uso. Puedes asociar cada tipo de material a una categoría.
      </p>

      <CatalogList
        items={items.map((category) => ({ id: category.id, name: category.name }))}
        emptyMessage="Todavía no hay categorías."
        noun="la categoría"
        confirmId={confirmId}
        archivingId={archivingId}
        onRequestArchive={(id) => setConfirmId(id)}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={(id, value) => void handleArchive(id, value)}
      />

      <form className="flex flex-col gap-3" onSubmit={handleAdd} noValidate>
        <TextField
          label="Nueva categoría"
          hint="Por ejemplo: EPP, Extinción, Rescate."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" loading={adding}>
            Agregar categoría
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MaterialTypesSection({
  items,
  categories,
  csrfToken,
  onChanged,
  onNotice,
  onError,
}: {
  items: readonly MaterialTypeOption[];
  categories: readonly CategoryOption[];
  csrfToken: string;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  const categoryName = (id: number | null): string => {
    if (id === null) return 'Sin categoría';
    return categories.find((category) => category.id === id)?.name ?? 'Sin categoría';
  };

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    onNotice(null);
    try {
      await createMaterialType(
        { name: value, categoryId: categoryId ? Number(categoryId) : null },
        csrfToken,
      );
      setName('');
      onNotice(`Tipo de material «${value}» agregado.`);
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? 'Ese tipo de material ya existe.'
          : errorMessage(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleArchive(id: number, value: string) {
    if (archivingId !== null) return;
    setArchivingId(id);
    onError(null);
    onNotice(null);
    try {
      await archiveMaterialType(id, csrfToken);
      setConfirmId(null);
      onNotice(`Tipo de material «${value}» archivado.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Tipos de material</h2>
      <p className="text-base text-ink-muted">
        Diferencian los materiales dentro de una categoría. Puedes dejarlos sin categoría.
      </p>

      <CatalogList
        items={items.map((type) => ({
          id: type.id,
          name: type.name,
          meta: categoryName(type.category_id),
        }))}
        emptyMessage="Todavía no hay tipos de material."
        noun="el tipo de material"
        confirmId={confirmId}
        archivingId={archivingId}
        onRequestArchive={(id) => setConfirmId(id)}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={(id, value) => void handleArchive(id, value)}
      />

      <form className="flex flex-col gap-3" onSubmit={handleAdd} noValidate>
        <TextField
          label="Nuevo tipo de material"
          hint="Por ejemplo: Casco, Botín, Arnés."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          label="Categoría"
          options={categories.map((category) => ({
            value: String(category.id),
            label: category.name,
          }))}
          placeholder="Sin categoría"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        />
        <div>
          <Button type="submit" loading={adding}>
            Agregar tipo de material
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ConditionsCard({ conditions }: { conditions: readonly ConditionOption[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-ink">Estados</h2>
      <p className="text-base text-ink-muted">
        Cada estado define qué se considera disponible: solo las existencias en un estado
        disponible suman al total utilizable del inventario.
      </p>

      {conditions.length === 0 ? (
        <StatusMessage>No hay estados configurados.</StatusMessage>
      ) : (
        <ul className="flex flex-col gap-2">
          {conditions.map((condition) => (
            <li
              key={condition.code}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
            >
              <span className="text-base text-ink">{condition.name}</span>
              <span className="text-sm text-ink-muted">
                {condition.is_available === 1
                  ? 'Cuenta como disponible'
                  : 'No cuenta como disponible'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function InventoryCatalogPage({ csrfToken }: { csrfToken: string }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const state = useAsync<InventoryCatalog>(
    (signal) => fetchInventoryCatalog(signal),
    [reloadToken],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catálogo del inventario"
        description="Ubicaciones, categorías y tipos de material que se usan al registrar el inventario."
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? (
        <Alert tone="error" title="No se pudo completar">
          {error}
        </Alert>
      ) : null}

      {state.status === 'loading' ? <StatusMessage busy>Cargando el catálogo…</StatusMessage> : null}

      {state.status === 'error' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="error" title="No se pudo cargar el catálogo">
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
        <>
          <LocationsSection
            items={state.data.locations}
            csrfToken={csrfToken}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <CategoriesSection
            items={state.data.categories}
            csrfToken={csrfToken}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <MaterialTypesSection
            items={state.data.materialTypes}
            categories={state.data.categories}
            csrfToken={csrfToken}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <ConditionsCard conditions={state.data.conditions} />
        </>
      ) : null}
    </div>
  );
}
