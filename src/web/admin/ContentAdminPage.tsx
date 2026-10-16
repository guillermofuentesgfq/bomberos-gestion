/**
 * Gestión del contenido del sitio público.
 *
 * Lista y publica páginas, noticias, actividades y galerías. Permite crear
 * noticias; el resto del contenido se completa desde la API.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { errorMessage } from './adminApi';
import { StatusMessage, TextAreaField } from './adminFields';
import {
  createNews,
  fetchContentList,
  transitionContent,
  type ContentItem,
  type ContentKind,
  type ContentStatus,
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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', { dateStyle: 'medium' });
}

export function ContentAdminPage({ csrfToken }: { csrfToken: string }) {
  const [kind, setKind] = useState<ContentKind>('news');
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Formulario de alta de noticia.
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(null);
    void controller;

    fetchContentList(kind, null)
      .then(setItems)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(errorMessage(cause));
      });

    return () => controller.abort();
  }, [kind, reloadToken]);

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

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setNotice(null);
    try {
      const created = await createNews(
        { title: title.trim(), summary: summary.trim() || null, body: body.trim() || null },
        csrfToken,
      );
      setTitle('');
      setSummary('');
      setBody('');
      setNotice(`Noticia creada como borrador (${created.slug}). Publícala cuando esté lista.`);
      if (kind === 'news') reload();
    } catch (cause) {
      setCreateError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  const active = KINDS.find((entry) => entry.kind === kind);

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
            onClick={() => setKind(entry.kind)}
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
                  <tr key={item.id} className="border-b border-line/60 align-middle">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-ink">Nueva noticia</h2>
        <p className="text-base text-ink-muted">
          Se crea como borrador. Aparecerá en el sitio público cuando pulses «Publicar».
        </p>

        {createError ? <Alert tone="error" title="No se pudo crear la noticia">{createError}</Alert> : null}

        <form className="flex flex-col gap-5" onSubmit={handleCreate} noValidate>
          <TextField
            id="news-title"
            label="Título"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextField
            id="news-summary"
            label="Resumen"
            hint="Una o dos frases para el listado."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <TextAreaField
            id="news-body"
            label="Cuerpo"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
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
