/**
 * Configuración de la sección de postulación del sitio público.
 *
 * Los requisitos son texto enriquecido: se editan con el mismo editor del resto
 * del CMS y el **servidor los sanea al guardar** (lista blanca de etiquetas).
 * Aquí solo se edita; la defensa no vive en el cliente.
 */

import { useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RichTextEditor } from '../components/RichTextEditor';
import { TextField } from '../components/TextField';
import { errorMessage } from './adminApi';
import { TextAreaField } from './adminFields';
import { updateSection, type SiteSection } from './settingsApi';

export interface ApplySettingsValues {
  title: string;
  intro: string;
  requirements: string;
  isOpen: boolean;
  closedMessage: string;
  consentText: string;
  successMessage: string;
}

const DEFAULTS: ApplySettingsValues = {
  title: 'Postula a la compañía',
  intro: '',
  requirements: '',
  isOpen: true,
  closedMessage: 'Las postulaciones están cerradas por ahora.',
  consentText: 'Autorizo el tratamiento de mis datos personales para participar del proceso.',
  successMessage: 'Recibimos tu postulación.',
};

function readSettings(section: SiteSection): ApplySettingsValues {
  const raw = section.settings ?? {};
  const text = (key: keyof ApplySettingsValues, fallback: string): string =>
    typeof raw[key] === 'string' ? (raw[key] as string) : fallback;
  return {
    title: text('title', DEFAULTS.title),
    intro: text('intro', DEFAULTS.intro),
    requirements: text('requirements', DEFAULTS.requirements),
    isOpen: typeof raw.isOpen === 'boolean' ? raw.isOpen : true,
    closedMessage: text('closedMessage', DEFAULTS.closedMessage),
    consentText: text('consentText', DEFAULTS.consentText),
    successMessage: text('successMessage', DEFAULTS.successMessage),
  };
}

export function ApplySettings({
  section,
  csrfToken,
}: {
  section: SiteSection;
  csrfToken: string;
}) {
  const [values, setValues] = useState<ApplySettingsValues>(() => readSettings(section));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function patch(partial: Partial<ApplySettingsValues>): void {
    setValues((current) => ({ ...current, ...partial }));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateSection(section.key, { settings: { ...values } }, csrfToken);
      setNotice('La sección de postulación quedó guardada. El sitio se actualiza en unos segundos.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-ink">Postulación de nuevos integrantes</h2>
        <p className="max-w-[70ch] text-base text-ink-muted">
          Formulario público para recibir postulaciones. Las postulaciones llegan al apartado
          «Postulantes» del panel. Los requisitos se muestran en la portada.
          {section.isEnabled
            ? ' La sección está visible en el sitio.'
            : ' La sección está desactivada: actívala en «Secciones de la portada» para publicarla.'}
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <form className="flex flex-col gap-5" onSubmit={(event) => void handleSave(event)} noValidate>
        <TextField
          id="apply-title"
          label="Título de la sección"
          value={values.title}
          onChange={(event) => patch({ title: event.target.value })}
        />

        <RichTextEditor
          id="apply-intro"
          label="Introducción"
          hint="Texto breve que presenta la convocatoria."
          value={values.intro}
          onChange={(html) => patch({ intro: html })}
        />

        <RichTextEditor
          id="apply-requirements"
          label="Requisitos de postulación"
          hint="Lista de requisitos, condiciones y documentos. Es texto enriquecido."
          value={values.requirements}
          onChange={(html) => patch({ requirements: html })}
        />

        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            checked={values.isOpen}
            onChange={(event) => patch({ isOpen: event.target.checked })}
            className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
          />
          <span className="font-semibold">Postulaciones abiertas</span>
        </label>
        <p className="-mt-3 text-sm text-ink-muted">
          Si se cierra, el formulario se sustituye por el mensaje de cierre.
        </p>

        <TextAreaField
          id="apply-closed"
          label="Mensaje cuando está cerrado"
          value={values.closedMessage}
          onChange={(event) => patch({ closedMessage: event.target.value })}
        />
        <TextAreaField
          id="apply-consent"
          label="Texto de consentimiento"
          hint="Se muestra junto a la casilla obligatoria del formulario."
          value={values.consentText}
          onChange={(event) => patch({ consentText: event.target.value })}
        />
        <TextAreaField
          id="apply-success"
          label="Mensaje de éxito"
          value={values.successMessage}
          onChange={(event) => patch({ successMessage: event.target.value })}
        />

        <div>
          <Button type="submit" loading={busy}>
            Guardar sección de postulación
          </Button>
        </div>
      </form>
    </Card>
  );
}
