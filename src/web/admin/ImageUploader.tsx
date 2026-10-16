/**
 * Subida de una imagen a `/api/v1/files`.
 *
 * El servidor valida el contenido real (PNG, JPEG o WEBP), el tamaño y las
 * dimensiones, y rechaza contenido activo como SVG. Aquí se hace una
 * comprobación previa para dar un mensaje inmediato, no como única defensa.
 */

import { useId, useRef, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { ApiError } from '../lib/api';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = 'image/png,image/jpeg,image/webp';

interface UploadResponse {
  id: number;
  contentType: string;
  width: number | null;
  height: number | null;
}

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

export interface ImageUploaderProps {
  csrfToken: string;
  label: string;
  hint?: string | undefined;
  /** Identificador del objeto en R2, o null si no hay imagen. */
  value: number | null;
  onChange: (objectId: number | null) => void;
  /**
   * Las imágenes del sitio público deben ser públicas para poder servirse sin
   * sesión. Las del inventario se quedan privadas.
   */
  isPublic?: boolean | undefined;
}

async function uploadImage(
  file: File,
  csrfToken: string,
  isPublic: boolean,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('isPublic', isPublic ? 'true' : 'false');

  let response: Response;
  try {
    response = await fetch('/api/v1/files', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      credentials: 'include',
      body: form,
    });
  } catch {
    throw new ApiError('network_error', 0, 'No se pudo contactar el servidor.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    const envelope = payload as { ok: true; data: UploadResponse } | ErrorEnvelope;
    if (envelope.ok) return envelope.data;
    throw new ApiError(envelope.error.code, response.status, envelope.error.message);
  }
  throw new ApiError('invalid_response', response.status, 'El servidor devolvió una respuesta inesperada.');
}

function previewUrlFor(objectId: number): string {
  return `/api/v1/files/${objectId}`;
}

export function ImageUploader({
  csrfToken,
  label,
  hint,
  value,
  onChange,
  isPublic = true,
}: ImageUploaderProps) {
  const inputId = useId();
  const cameraId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedPreview, setFailedPreview] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    setError(null);

    if (!ACCEPTED.split(',').includes(file.type)) {
      setError('Formato no admitido. Usa PNG, JPG o WEBP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('La imagen supera los 5 MB. Redúcela e inténtalo de nuevo.');
      return;
    }

    setBusy(true);
    try {
      const uploaded = await uploadImage(file, csrfToken, isPublic);
      setFailedPreview(false);
      onChange(uploaded.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo subir la imagen.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {hint ? <span className="text-sm text-ink-muted">{hint}</span> : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-muted">
          {value && !failedPreview ? (
            <img
              src={previewUrlFor(value)}
              alt={`Vista previa de ${label}`}
              className="h-full w-full object-cover"
              onError={() => setFailedPreview(true)}
            />
          ) : (
            <span className="px-2 text-center text-xs text-ink-muted">
              {failedPreview ? 'No se pudo mostrar' : 'Sin imagen'}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <input
            ref={cameraRef}
            id={cameraId}
            type="file"
            accept={ACCEPTED}
            capture="environment"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="min-h-9 px-3 py-1 text-sm"
              loading={busy}
              onClick={() => inputRef.current?.click()}
            >
              {value ? 'Cambiar imagen' : 'Subir imagen'}
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 px-3 py-1 text-sm"
              disabled={busy}
              onClick={() => cameraRef.current?.click()}
            >
              Tomar foto
            </Button>
            {value ? (
              <Button
                variant="secondary"
                className="min-h-9 px-3 py-1 text-sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setFailedPreview(false);
                  onChange(null);
                }}
              >
                Quitar
              </Button>
            ) : null}
          </div>

          <span className="text-xs text-ink-muted">
            PNG, JPG o WEBP · hasta 5 MB · máx. 8000 px por lado
          </span>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
