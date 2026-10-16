/**
 * Catálogo de personas.
 *
 * Sub-sección de Personas con los cargos y las calidades que se asignan al
 * personal. Cada listado permite crear elementos, editarlos en línea (una fila
 * a la vez) y archivarlos con una confirmación en dos pasos (sin
 * `window.confirm`), con la misma mecánica que el catálogo del inventario.
 */

import { useCallback, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { StatusMessage } from './adminFields';
import {
  archivePositionType,
  archiveQuality,
  createPositionType,
  createQuality,
  errorMessage,
  fetchPersonsCatalog,
  updatePositionType,
  updateQuality,
} from './adminApi';
import type { PersonsCatalog, PositionType, Quality } from './adminApi';

interface CatalogEntry {
  id: number;
  name: string;
}

interface CatalogListProps<T extends CatalogEntry> {
  items: readonly T[];
  emptyMessage: string;
  noun: string;
  confirmId: number | null;
  editingId: number | null;
  archivingId: number | null;
  saving: boolean;
  onRequestArchive: (id: number) => void;
  onCancelArchive: () => void;
  onArchive: (id: number, name: string) => void;
  onStartEdit: (id: number) => void;
  onCancelEdit: () => void;
  renderEditForm: (item: T) => ReactNode;
}

/**
 * Listado del catálogo con edición en línea y confirmación en dos pasos para
 * archivar. Solo una fila puede estar en edición a la vez: el formulario se
 * despliega dentro de la misma fila y el botón «Editar» expone `aria-expanded`.
 */
function CatalogList<T extends CatalogEntry>({
  items,
  emptyMessage,
  noun,
  confirmId,
  editingId,
  archivingId,
  saving,
  onRequestArchive,
  onCancelArchive,
  onArchive,
  onStartEdit,
  onCancelEdit,
  renderEditForm,
}: CatalogListProps<T>) {
  if (items.length === 0) {
    return <StatusMessage>{emptyMessage}</StatusMessage>;
  }

  const busy = archivingId !== null || saving;

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
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base text-ink">{item.name}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-9 px-3 py-1 text-sm"
                    disabled={busy}
                    aria-expanded={editingId === item.id}
                    aria-label={`Editar ${noun} ${item.name}`}
                    onClick={() => (editingId === item.id ? onCancelEdit() : onStartEdit(item.id))}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-9 px-3 py-1 text-sm"
                    disabled={busy}
                    aria-label={`Archivar ${noun} ${item.name}`}
                    onClick={() => onRequestArchive(item.id)}
                  >
                    Archivar
                  </Button>
                </div>
              </div>
              {editingId === item.id ? renderEditForm(item) : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function PositionsSection({
  items,
  csrfToken,
  onChanged,
  onNotice,
  onError,
}: {
  items: readonly PositionType[];
  csrfToken: string;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    onNotice(null);
    try {
      await createPositionType({ name: value }, csrfToken);
      setName('');
      onNotice(`Cargo «${value}» agregado.`);
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? 'Ese cargo ya existe.'
          : errorMessage(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  function startEdit(positionType: PositionType) {
    setConfirmId(null);
    setEditingId(positionType.id);
    setEditName(positionType.name);
    setNameError(null);
    onError(null);
    onNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setNameError(null);
  }

  async function handleSave(id: number) {
    if (saving) return;
    const value = editName.trim();
    if (!value) {
      setNameError('Escribe un nombre para el cargo.');
      return;
    }
    setNameError(null);
    setSaving(true);
    onError(null);
    onNotice(null);
    try {
      await updatePositionType(id, { name: value }, csrfToken);
      setEditingId(null);
      onNotice(`Cargo «${value}» actualizado.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: number, value: string) {
    if (archivingId !== null) return;
    setArchivingId(id);
    onError(null);
    onNotice(null);
    try {
      await archivePositionType(id, csrfToken);
      setConfirmId(null);
      onNotice(`Cargo «${value}» archivado.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Cargos</h2>
      <p className="text-base text-ink-muted">
        Son las denominaciones que se asignan a una persona en su historial de cargos.
      </p>

      <CatalogList
        items={items}
        emptyMessage="Todavía no hay cargos."
        noun="el cargo"
        confirmId={confirmId}
        editingId={editingId}
        archivingId={archivingId}
        saving={saving}
        onRequestArchive={(id) => {
          cancelEdit();
          setConfirmId(id);
        }}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={(id, value) => void handleArchive(id, value)}
        onStartEdit={(id) => {
          const positionType = items.find((entry) => entry.id === id);
          if (positionType) startEdit(positionType);
        }}
        onCancelEdit={cancelEdit}
        renderEditForm={(positionType) => (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave(positionType.id);
            }}
          >
            <TextField
              label="Nombre"
              required
              value={editName}
              error={nameError ?? undefined}
              onChange={(event) => {
                setEditName(event.target.value);
                if (nameError) setNameError(null);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-9 px-3 py-1 text-sm" loading={saving}>
                Guardar cambios
              </Button>
              <Button
                variant="secondary"
                className="min-h-9 px-3 py-1 text-sm"
                disabled={saving}
                onClick={cancelEdit}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      />

      <form className="flex flex-col gap-3" onSubmit={handleAdd} noValidate>
        <TextField
          label="Nuevo cargo"
          hint="Por ejemplo: Capitán, Teniente, Ayudante."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" loading={adding}>
            Agregar cargo
          </Button>
        </div>
      </form>
    </Card>
  );
}

function QualitiesSection({
  items,
  csrfToken,
  onChanged,
  onNotice,
  onError,
}: {
  items: readonly Quality[];
  csrfToken: string;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    onNotice(null);
    try {
      await createQuality({ name: value }, csrfToken);
      setName('');
      onNotice(`Calidad «${value}» agregada.`);
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? 'Esa calidad ya existe.'
          : errorMessage(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  function startEdit(quality: Quality) {
    setConfirmId(null);
    setEditingId(quality.id);
    setEditName(quality.name);
    setNameError(null);
    onError(null);
    onNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setNameError(null);
  }

  async function handleSave(id: number) {
    if (saving) return;
    const value = editName.trim();
    if (!value) {
      setNameError('Escribe un nombre para la calidad.');
      return;
    }
    setNameError(null);
    setSaving(true);
    onError(null);
    onNotice(null);
    try {
      await updateQuality(id, { name: value }, csrfToken);
      setEditingId(null);
      onNotice(`Calidad «${value}» actualizada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: number, value: string) {
    if (archivingId !== null) return;
    setArchivingId(id);
    onError(null);
    onNotice(null);
    try {
      await archiveQuality(id, csrfToken);
      setConfirmId(null);
      onNotice(`Calidad «${value}» archivada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Calidades</h2>
      <p className="text-base text-ink-muted">
        Es la condición de la persona en la compañía, por ejemplo voluntario o aspirante.
      </p>

      <CatalogList
        items={items}
        emptyMessage="Todavía no hay calidades."
        noun="la calidad"
        confirmId={confirmId}
        editingId={editingId}
        archivingId={archivingId}
        saving={saving}
        onRequestArchive={(id) => {
          cancelEdit();
          setConfirmId(id);
        }}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={(id, value) => void handleArchive(id, value)}
        onStartEdit={(id) => {
          const quality = items.find((entry) => entry.id === id);
          if (quality) startEdit(quality);
        }}
        onCancelEdit={cancelEdit}
        renderEditForm={(quality) => (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave(quality.id);
            }}
          >
            <TextField
              label="Nombre"
              required
              value={editName}
              error={nameError ?? undefined}
              onChange={(event) => {
                setEditName(event.target.value);
                if (nameError) setNameError(null);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-9 px-3 py-1 text-sm" loading={saving}>
                Guardar cambios
              </Button>
              <Button
                variant="secondary"
                className="min-h-9 px-3 py-1 text-sm"
                disabled={saving}
                onClick={cancelEdit}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      />

      <form className="flex flex-col gap-3" onSubmit={handleAdd} noValidate>
        <TextField
          label="Nueva calidad"
          hint="Por ejemplo: Voluntario, Aspirante, Honorario."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" loading={adding}>
            Agregar calidad
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PersonsCatalogPage({ csrfToken }: { csrfToken: string }): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const state = useAsync<PersonsCatalog>(
    (signal) => fetchPersonsCatalog(signal),
    [reloadToken],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catálogo de personas"
        description="Cargos y calidades que se asignan al personal de la institución."
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
          <PositionsSection
            items={state.data.positionTypes}
            csrfToken={csrfToken}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <QualitiesSection
            items={state.data.qualities}
            csrfToken={csrfToken}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
        </>
      ) : null}
    </div>
  );
}
