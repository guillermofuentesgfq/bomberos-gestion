/**
 * Gestión del contenido del sitio público.
 *
 * Lista y publica páginas, noticias, actividades y galerías. Permite crear
 * noticias (con imagen de portada), elegir la portada o imagen principal de un
 * contenido existente y administrar las fotos de cada galería: agregar,
 * describir, reordenar y eliminar.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { errorMessage } from './adminApi';
import { SelectField, StatusMessage, TextAreaField } from './adminFields';
import { ImageUploader } from './ImageUploader';
import {
  addGalleryPhotos,
  createNews,
  createPage,
  createActivity,
  createGallery,
  deleteGalleryPhoto,
  fetchContentList,
  fetchGalleryDetail,
  reorderGalleryPhotos,
  transitionContent,
  updateActivityCover,
  updateNewsCover,
  updatePageCover,
  type ContentItem,
  type ContentKind,
  type ContentStatus,
  type GalleryDetail,
  type GalleryPhoto,
} from './contentApi';

const KINDS: { kind: ContentKind; label: string; singular: string }[] = [
  { kind: 'pages', label: 'Páginas', singular: 'página' },
  { kind: 'news', label: 'Noticias', singular: 'noticia' },
  { kind: 'activities', label: 'Actividades', singular: 'actividad' },
  { kind: 'galleries', label: 'Galerías', singular: 'galería' },
];

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

const STATUS_CLASSES: Record<ContentStatus, string> = {
  draft: 'border-amber-600 bg-amber-500/10 text-ink',
  published: 'border-emerald-700 bg-emerald-600/10 text-ink',
  archived: 'border-line bg-muted text-ink-muted',
};

/** Etiqueta larga del campo de imagen según la colección. */
const COVER_LABEL: Record<ContentKind, string> = {
  pages: 'Imagen principal',
  news: 'Imagen de portada',
  activities: 'Imagen de portada',
  galleries: 'Imagen de portada',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', { dateStyle: 'medium' });
}

function coverValue(item: ContentItem, kind: ContentKind): number | null {
  return kind === 'pages' ? item.heroObjectId ?? null : item.coverObjectId ?? null;
}

/** Nombre legible de una foto para los `aria-label` de sus botones. */
function photoName(photo: GalleryPhoto, index: number): string {
  const text = (photo.altText ?? photo.caption ?? '').trim();
  return text.length > 0 ? text : `Foto ${index + 1}`;
}

async function saveCover(
  kind: ContentKind,
  id: number,
  objectId: number | null,
  csrfToken: string,
): Promise<void> {
  switch (kind) {
    case 'pages':
      await updatePageCover(id, objectId, csrfToken);
      return;
    case 'news':
      await updateNewsCover(id, objectId, csrfToken);
      return;
    case 'activities':
      await updateActivityCover(id, objectId, csrfToken);
      return;
    case 'galleries':
      return;
  }
}

export function ContentAdminPage({ csrfToken }: { csrfToken: string }) {
  const [kind, setKind] = useState<ContentKind>('news');
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Formulario de alta de contenido (el tipo depende de la pestaña activa).
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [locationText, setLocationText] = useState('');
  const [createCoverObjectId, setCreateCoverObjectId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Gestión de la portada o imagen principal de un contenido existente.
  const [coverEditId, setCoverEditId] = useState<number | null>(null);
  const [coverDraft, setCoverDraft] = useState<number | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  // Gestión de las fotos de una galería.
  const [selectedGalleryId, setSelectedGalleryId] = useState<number | null>(null);
  const [gallery, setGallery] = useState<GalleryDetail | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryNotice, setGalleryNotice] = useState<string | null>(null);
  const [galleryReloadToken, setGalleryReloadToken] = useState(0);
  const [photoBusyId, setPhotoBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const [pendingObjectId, setPendingObjectId] = useState<number | null>(null);
  const [pendingAlt, setPendingAlt] = useState('');
  const [pendingCaption, setPendingCaption] = useState('');
  const [addingPhoto, setAddingPhoto] = useState(false);
  const loadedGalleryId = useRef<number | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const reloadGallery = useCallback(() => setGalleryReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(null);
    setCoverEditId(null);
    setCoverError(null);

    fetchContentList(kind, null, controller.signal)
      .then(setItems)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(errorMessage(cause));
      });

    return () => controller.abort();
  }, [kind, reloadToken]);

  // Al entrar en Galerías, selecciona la primera galería disponible.
  useEffect(() => {
    if (kind !== 'galleries' || items === null || items.length === 0) return;
    setSelectedGalleryId((current) => {
      if (current !== null && items.some((item) => item.id === current)) return current;
      return items[0]?.id ?? null;
    });
  }, [kind, items]);

  // Carga las fotos de la galería seleccionada.
  useEffect(() => {
    if (kind !== 'galleries' || selectedGalleryId === null) {
      loadedGalleryId.current = null;
      setGallery(null);
      setGalleryLoading(false);
      setGalleryError(null);
      return;
    }

    if (loadedGalleryId.current !== selectedGalleryId) {
      loadedGalleryId.current = selectedGalleryId;
      setGallery(null);
    }

    const controller = new AbortController();
    setGalleryLoading(true);
    setGalleryError(null);

    fetchGalleryDetail(selectedGalleryId, null, controller.signal)
      .then((detail) => setGallery(detail))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setGalleryError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGalleryLoading(false);
      });

    return () => controller.abort();
  }, [kind, selectedGalleryId, galleryReloadToken]);

  // Al cambiar de galería, descarta la foto pendiente y las confirmaciones.
  useEffect(() => {
    setPendingObjectId(null);
    setPendingAlt('');
    setPendingCaption('');
    setConfirmDeleteId(null);
  }, [selectedGalleryId, kind]);

  async function handleTransition(
    item: ContentItem,
    action: 'publish' | 'unpublish' | 'archive',
  ) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await transitionContent(kind, item.id, action, csrfToken);
      setNotice(`«${item.title}» quedó como ${STATUS_LABELS[result.status].toLocaleLowerCase()}.`);
      reload();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'forbidden'
          ? 'No tienes permiso para publicar o retirar contenido.'
          : errorMessage(cause),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setNotice(null);

    const cleanTitle = title.trim();
    const subtitle = summary.trim() || null;
    const bodyText = body.trim() || null;

    try {
      let created: { id: number; slug: string };
      switch (kind) {
        case 'pages':
          created = await createPage(
            { title: cleanTitle, excerpt: subtitle, body: bodyText, heroObjectId: createCoverObjectId },
            csrfToken,
          );
          break;
        case 'activities':
          created = await createActivity(
            {
              title: cleanTitle,
              summary: subtitle,
              body: bodyText,
              startsAt: startsAt.trim() || null,
              endsAt: endsAt.trim() || null,
              locationText: locationText.trim() || null,
              coverObjectId: createCoverObjectId,
            },
            csrfToken,
          );
          break;
        case 'galleries':
          created = await createGallery({ title: cleanTitle, description: subtitle }, csrfToken);
          break;
        default:
          created = await createNews(
            { title: cleanTitle, summary: subtitle, body: bodyText, coverObjectId: createCoverObjectId },
            csrfToken,
          );
      }

      setTitle('');
      setSummary('');
      setBody('');
      setStartsAt('');
      setEndsAt('');
      setLocationText('');
      setCreateCoverObjectId(null);
      setNotice(
        `«${cleanTitle}» se creó como borrador (${created.slug}). Publícala cuando esté lista.`,
      );
      reload();
    } catch (cause) {
      setCreateError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  function openCoverEditor(item: ContentItem) {
    if (coverEditId === item.id) {
      setCoverEditId(null);
      setCoverError(null);
      return;
    }
    setCoverEditId(item.id);
    setCoverDraft(coverValue(item, kind));
    setCoverError(null);
  }

  async function handleSaveCover(item: ContentItem) {
    if (coverSaving) return;
    setCoverSaving(true);
    setCoverError(null);
    setNotice(null);
    try {
      await saveCover(kind, item.id, coverDraft, csrfToken);
      setCoverEditId(null);
      setNotice(`${COVER_LABEL[kind]} de «${item.title}» actualizada.`);
      reload();
    } catch (cause) {
      setCoverError(errorMessage(cause));
    } finally {
      setCoverSaving(false);
    }
  }

  async function handleAddPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addingPhoto || selectedGalleryId === null || pendingObjectId === null) return;
    if (pendingAlt.trim().length === 0) return;
    setAddingPhoto(true);
    setGalleryError(null);
    setGalleryNotice(null);
    try {
      await addGalleryPhotos(
        selectedGalleryId,
        [
          {
            objectId: pendingObjectId,
            altText: pendingAlt.trim(),
            caption: pendingCaption.trim() || null,
          },
        ],
        csrfToken,
      );
      setPendingObjectId(null);
      setPendingAlt('');
      setPendingCaption('');
      setGalleryNotice('Foto agregada a la galería.');
      reloadGallery();
    } catch (cause) {
      setGalleryError(errorMessage(cause));
    } finally {
      setAddingPhoto(false);
    }
  }

  async function handleDeletePhoto(photo: GalleryPhoto) {
    if (selectedGalleryId === null || photoBusyId !== null) return;
    setPhotoBusyId(photo.id);
    setGalleryError(null);
    setGalleryNotice(null);
    try {
      await deleteGalleryPhoto(selectedGalleryId, photo.id, csrfToken);
      setConfirmDeleteId(null);
      setGalleryNotice('Foto eliminada de la galería.');
      reloadGallery();
    } catch (cause) {
      setGalleryError(errorMessage(cause));
    } finally {
      setPhotoBusyId(null);
    }
  }

  async function handleMovePhoto(index: number, direction: -1 | 1) {
    if (selectedGalleryId === null || gallery === null || reordering) return;
    const photos = gallery.photos;
    const current = photos[index];
    const neighbour = photos[index + direction];
    if (!current || !neighbour) return;

    const order = photos.map((photo) => photo.id);
    order[index] = neighbour.id;
    order[index + direction] = current.id;

    setReordering(true);
    setGalleryError(null);
    setGalleryNotice(null);
    try {
      await reorderGalleryPhotos(selectedGalleryId, order, csrfToken);
      reloadGallery();
    } catch (cause) {
      setGalleryError(errorMessage(cause));
    } finally {
      setReordering(false);
    }
  }

  const active = KINDS.find((entry) => entry.kind === kind);
  const supportsCover = kind !== 'galleries';
  const photos = gallery?.photos ?? [];
  const photosBusy = galleryLoading || reordering;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contenido del sitio"
        description="Crea, publica y retira el contenido que aparece en el sitio público."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de contenido">
        {KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="tab"
            aria-selected={entry.kind === kind}
            onClick={() => {
              setKind(entry.kind);
              setCoverEditId(null);
              setCoverError(null);
            }}
            className={
              entry.kind === kind
                ? 'inline-flex min-h-11 cursor-pointer items-center rounded-lg border-2 border-brand bg-brand/5 px-4 text-sm font-semibold text-brand'
                : 'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-muted hover:text-ink'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {error ? (
        <Alert tone="error" title="No se pudo completar la operación">
          {error}{' '}
          <button
            type="button"
            onClick={reload}
            className="cursor-pointer font-semibold underline underline-offset-2"
          >
            Reintentar
          </button>
        </Alert>
      ) : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-ink">
          {active?.label ?? 'Contenido'}
        </h2>

        {items === null && !error ? <StatusMessage>Cargando contenido…</StatusMessage> : null}

        {items !== null && items.length === 0 ? (
          <StatusMessage>
            Todavía no hay {active?.label.toLocaleLowerCase() ?? 'contenido'}. Crea la primera
            noticia con el formulario de abajo.
          </StatusMessage>
        ) : null}

        {items !== null && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{active?.label ?? 'Contenido'}</caption>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Título</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Estado</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Publicado</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Fragment key={item.id}>
                    <tr className="border-b border-line/60 align-middle">
                      <td className="px-3 py-2">
                        <span className="font-semibold text-ink">{item.title}</span>
                        <span className="block text-xs text-ink-muted">/{item.slug}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[item.status]}`}
                        >
                          {STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-muted tabular-nums">
                        {formatDate(item.publishedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.status !== 'published' ? (
                            <Button
                              variant="primary"
                              className="min-h-9 px-3 py-1 text-sm"
                              loading={busyId === item.id}
                              onClick={() => handleTransition(item, 'publish')}
                              aria-label={`Publicar ${active?.singular ?? 'elemento'} ${item.title}`}
                            >
                              Publicar
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              className="min-h-9 px-3 py-1 text-sm"
                              loading={busyId === item.id}
                              onClick={() => handleTransition(item, 'unpublish')}
                              aria-label={`Retirar ${active?.singular ?? 'elemento'} ${item.title}`}
                            >
                              Retirar
                            </Button>
                          )}
                          {item.status !== 'archived' ? (
                            <Button
                              variant="secondary"
                              className="min-h-9 px-3 py-1 text-sm"
                              loading={busyId === item.id}
                              onClick={() => handleTransition(item, 'archive')}
                              aria-label={`Archivar ${active?.singular ?? 'elemento'} ${item.title}`}
                            >
                              Archivar
                            </Button>
                          ) : null}
                          {supportsCover ? (
                            <Button
                              variant="secondary"
                              className="min-h-9 px-3 py-1 text-sm"
                              aria-expanded={coverEditId === item.id}
                              aria-label={`${COVER_LABEL[kind]} de ${item.title}`}
                              onClick={() => openCoverEditor(item)}
                            >
                              {kind === 'pages' ? 'Imagen principal' : 'Portada'}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {coverEditId === item.id ? (
                      <tr className="border-b border-line/60 bg-muted">
                        <td colSpan={4} className="px-3 py-4">
                          <div className="flex max-w-xl flex-col gap-4">
                            <ImageUploader
                              csrfToken={csrfToken}
                              label={COVER_LABEL[kind]}
                              hint="Se muestra en el listado y en la ficha del sitio. Debe ser pública."
                              value={coverDraft}
                              onChange={setCoverDraft}
                              isPublic={true}
                            />
                            {coverError ? <Alert tone="error">{coverError}</Alert> : null}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                loading={coverSaving}
                                onClick={() => handleSaveCover(item)}
                              >
                                {coverSaving ? 'Guardando…' : 'Guardar imagen'}
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={coverSaving}
                                onClick={() => {
                                  setCoverEditId(null);
                                  setCoverError(null);
                                }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {kind === 'galleries' && items !== null && items.length > 0 ? (
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-ink">Fotos de la galería</h2>
            <p className="text-base text-ink-muted">
              Elige una galería para ver y ordenar sus fotos. Cada foto necesita un texto
              alternativo para que sea accesible.
            </p>
          </div>

          <SelectField
            id="gallery-select"
            label="Galería"
            value={selectedGalleryId === null ? '' : String(selectedGalleryId)}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedGalleryId(value === '' ? null : Number(value));
            }}
            options={items.map((item) => ({ value: String(item.id), label: item.title }))}
            placeholder="Selecciona una galería"
          />

          {galleryError ? (
            <Alert tone="error" title="No se pudieron gestionar las fotos">
              {galleryError}
            </Alert>
          ) : null}

          {galleryNotice ? <Alert tone="success">{galleryNotice}</Alert> : null}

          <div
            aria-busy={photosBusy ? true : undefined}
            className="flex flex-col gap-5"
          >
            {galleryLoading && gallery === null ? (
              <StatusMessage busy>Cargando fotos…</StatusMessage>
            ) : null}

            {gallery !== null && photos.length === 0 ? (
              <StatusMessage>
                Esta galería todavía no tiene fotos. Agrega la primera más abajo.
              </StatusMessage>
            ) : null}

            {gallery !== null && photos.length > 0 ? (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((photo, index) => {
                  const name = photoName(photo, index);
                  return (
                    <li
                      key={photo.id}
                      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
                    >
                      <img
                        src={`/api/v1/files/${photo.objectId}`}
                        alt={photo.altText ?? photo.caption ?? `Foto ${index + 1}`}
                        className="h-40 w-full rounded-lg border border-line object-cover"
                      />
                      <dl className="flex flex-col gap-1 text-sm">
                        <div className="flex flex-col">
                          <dt className="font-semibold text-ink">Texto alternativo</dt>
                          <dd className="text-ink-muted">
                            {photo.altText ?? 'Sin descripción'}
                          </dd>
                        </div>
                        <div className="flex flex-col">
                          <dt className="font-semibold text-ink">Pie de foto</dt>
                          <dd className="text-ink-muted">{photo.caption ?? 'Sin pie de foto'}</dd>
                        </div>
                      </dl>
                      {confirmDeleteId === photo.id ? (
                        <div className="flex flex-col gap-2 rounded-lg border-2 border-destructive bg-destructive/10 p-3">
                          <p className="text-sm text-ink">
                            ¿Eliminar «{name}» de la galería?
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="danger"
                              className="min-h-9 px-3 py-1 text-sm"
                              loading={photoBusyId === photo.id}
                              onClick={() => handleDeletePhoto(photo)}
                            >
                              Sí, eliminar
                            </Button>
                            <Button
                              variant="secondary"
                              className="min-h-9 px-3 py-1 text-sm"
                              disabled={photoBusyId === photo.id}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            className="min-h-9 px-3 py-1 text-sm"
                            disabled={index === 0 || photosBusy}
                            aria-label={`Subir ${name}`}
                            onClick={() => handleMovePhoto(index, -1)}
                          >
                            Subir
                          </Button>
                          <Button
                            variant="secondary"
                            className="min-h-9 px-3 py-1 text-sm"
                            disabled={index === photos.length - 1 || photosBusy}
                            aria-label={`Bajar ${name}`}
                            onClick={() => handleMovePhoto(index, 1)}
                          >
                            Bajar
                          </Button>
                          <Button
                            variant="danger"
                            className="min-h-9 px-3 py-1 text-sm"
                            disabled={photosBusy}
                            aria-label={`Eliminar ${name}`}
                            onClick={() => setConfirmDeleteId(photo.id)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <form
            className="flex flex-col gap-5 border-t border-line pt-5"
            onSubmit={handleAddPhoto}
            noValidate
          >
            <h3 className="text-lg font-bold text-ink">Agregar una foto</h3>
            <ImageUploader
              csrfToken={csrfToken}
              label="Archivo de la imagen"
              hint="Se sube como imagen pública para que se vea en el sitio."
              value={pendingObjectId}
              onChange={setPendingObjectId}
              isPublic={true}
            />
            <TextField
              id="gallery-photo-alt"
              label="Texto alternativo"
              required
              hint="Describe la imagen para quien usa lector de pantalla."
              value={pendingAlt}
              onChange={(event) => setPendingAlt(event.target.value)}
            />
            <TextField
              id="gallery-photo-caption"
              label="Pie de foto"
              hint="Se muestra bajo la imagen en el sitio (opcional)."
              value={pendingCaption}
              onChange={(event) => setPendingCaption(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                loading={addingPhoto}
                disabled={pendingObjectId === null || pendingAlt.trim().length === 0}
              >
                Agregar a la galería
              </Button>
              {pendingObjectId === null ? (
                <span className="text-sm text-ink-muted">
                  Sube una imagen para habilitar el botón.
                </span>
              ) : pendingAlt.trim().length === 0 ? (
                <span className="text-sm text-ink-muted">
                  Escribe el texto alternativo para continuar.
                </span>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-ink">Nueva {active?.singular ?? 'contenido'}</h2>
        <p className="text-base text-ink-muted">
          Se crea como borrador. Aparecerá en el sitio público cuando pulses «Publicar».
        </p>

        {createError ? (
          <Alert tone="error" title="No se pudo crear el contenido">
            {createError}
          </Alert>
        ) : null}

        <form className="flex flex-col gap-5" onSubmit={handleCreate} noValidate>
          <TextField
            id="create-title"
            label="Título"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          {kind === 'galleries' ? (
            <TextAreaField
              id="create-subtitle"
              label="Descripción"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          ) : (
            <TextField
              id="create-subtitle"
              label="Resumen"
              hint="Una o dos frases para el listado."
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          )}

          {kind === 'galleries' ? null : (
            <TextAreaField
              id="create-body"
              label="Cuerpo"
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}

          {kind === 'activities' ? (
            <div className="grid gap-5 md:grid-cols-3">
              <TextField
                id="create-starts"
                type="date"
                label="Comienza"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
              <TextField
                id="create-ends"
                type="date"
                label="Termina"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
              <TextField
                id="create-location"
                label="Lugar"
                value={locationText}
                onChange={(event) => setLocationText(event.target.value)}
              />
            </div>
          ) : null}

          {kind === 'galleries' ? null : (
            <ImageUploader
              csrfToken={csrfToken}
              label={kind === 'pages' ? 'Imagen principal' : 'Imagen de portada'}
              hint="Se muestra en el listado y en la ficha. Debe ser pública."
              value={createCoverObjectId}
              onChange={setCreateCoverObjectId}
              isPublic={true}
            />
          )}

          <div>
            <Button type="submit" loading={creating}>
              {creating ? 'Creando…' : 'Crear borrador'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
