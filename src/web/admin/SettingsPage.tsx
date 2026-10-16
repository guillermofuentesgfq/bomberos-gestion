/**
 * Ajustes de la instalación.
 *
 * Dos bloques: secciones de la portada (activar, desactivar y ordenar) e
 * información institucional de la portada y SEO. El catálogo del inventario
 * (ubicaciones, categorías y tipos de material) vive ahora en su propia
 * sub-sección de Inventario.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { RichTextEditor } from '../components/RichTextEditor';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { toPlainText } from '../lib/richtext';
import { errorMessage } from './adminApi';
import { CheckboxField, StatusMessage, TextAreaField } from './adminFields';
import { ImageUploader } from './ImageUploader';
import {
  fetchInstitutionSettings,
  fetchSections,
  reorderSections,
  updateInstitution,
  updateSection,
  updateSeo,
  type InstitutionConfig,
  type SeoConfig,
  type SiteSection,
} from './settingsApi';

const SECTION_LABELS: Record<string, string> = {
  hero: 'Portada',
  about: 'Presentación',
  history: 'Historia',
  mission: 'Misión, visión y valores',
  specialties: 'Especialidades',
  gallery: 'Galería',
  news: 'Noticias',
  activities: 'Actividades',
  contact: 'Contacto',
  footer: 'Pie de página',
};

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key;
}

function linesToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(list: readonly string[]): string {
  return list.join('\n');
}

function socialsToText(socials: readonly { network: string; url: string }[]): string {
  return socials.map((social) => `${social.network} | ${social.url}`).join('\n');
}

function textToSocials(value: string): { network: string; url: string }[] {
  const items: { network: string; url: string }[] = [];
  for (const line of linesToList(value)) {
    const separator = line.indexOf('|');
    if (separator === -1) continue;
    const network = line.slice(0, separator).trim();
    const url = line.slice(separator + 1).trim();
    if (network && url) items.push({ network, url });
  }
  return items;
}

export function SettingsPage({ csrfToken }: { csrfToken: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [sections, setSections] = useState<SiteSection[]>([]);
  const [institution, setInstitution] = useState<InstitutionConfig | null>(null);
  const [seo, setSeo] = useState<SeoConfig | null>(null);

  const [phones, setPhones] = useState('');
  const [emails, setEmails] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [socials, setSocials] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<React.ReactNode>(null);
  const [blockError, setBlockError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([fetchInstitutionSettings(), fetchSections()])
      .then(([settings, siteSections]) => {
        if (cancelled) return;
        setInstitution(settings.institution);
        setSeo(settings.seo);
        setPhones(listToLines(settings.institution.phones));
        setEmails(listToLines(settings.institution.emails));
        setSpecialties(listToLines(settings.institution.specialties));
        setSocials(socialsToText(settings.institution.socials));
        setSections([...siteSections].sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function patchInstitution(field: keyof InstitutionConfig, value: string): void {
    setInstitution((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleSaveInstitution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!institution || !seo || busy) return;
    setBusy('institution');
    setNotice(null);
    setBlockError(null);
    try {
      await updateInstitution(
        {
          name: institution.name,
          number: institution.number,
          description: institution.description,
          history: institution.history,
          mission: institution.mission,
          vision: institution.vision,
          values: institution.values,
          corpsInfo: institution.corpsInfo,
          shieldObjectId: institution.shieldObjectId,
          logoObjectId: institution.logoObjectId,
          coverObjectId: institution.coverObjectId,
          primaryColor: institution.primaryColor,
          secondaryColor: institution.secondaryColor,
          address: institution.address,
          region: institution.region,
          commune: institution.commune,
          country: institution.country,
          emergencyNumber: institution.emergencyNumber,
          phones: linesToList(phones),
          emails: linesToList(emails),
          specialties: linesToList(specialties),
          socials: textToSocials(socials),
        },
        csrfToken,
      );
      await updateSeo(
        {
          title: seo.title,
          description: seo.description,
          ogImageObjectId: seo.ogImageObjectId,
          allowIndexing: seo.allowIndexing,
        },
        csrfToken,
      );
      setNotice(
        <>
          La información institucional quedó guardada.{' '}
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Ver el sitio público
          </a>
          . El sitio se actualiza en unos segundos.
        </>,
      );
    } catch (cause) {
      setBlockError(
        cause instanceof ApiError && cause.code === 'forbidden'
          ? 'No tienes permiso para editar el sitio.'
          : errorMessage(cause),
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleSection(section: SiteSection): Promise<void> {
    if (busy) return;
    setBusy(`section-${section.key}`);
    setBlockError(null);
    setNotice(null);
    try {
      await updateSection(section.key, { isEnabled: !section.isEnabled }, csrfToken);
      setSections((current) =>
        current.map((item) =>
          item.key === section.key ? { ...item, isEnabled: !item.isEnabled } : item,
        ),
      );
    } catch (cause) {
      setBlockError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function moveSection(index: number, direction: -1 | 1): Promise<void> {
    if (busy) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const current = next[index];
    const swapped = next[target];
    if (!current || !swapped) return;
    next[index] = swapped;
    next[target] = current;

    setBusy('sections-order');
    setBlockError(null);
    setNotice(null);
    try {
      await reorderSections(
        next.map((section) => section.key),
        csrfToken,
      );
      setSections(next.map((section, position) => ({ ...section, sortOrder: position + 1 })));
    } catch (cause) {
      setBlockError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Ajustes" description="Configuración de la instalación." />
        <Card>
          <StatusMessage>Cargando la configuración…</StatusMessage>
        </Card>
      </div>
    );
  }

  if (loadError || !institution || !seo) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Ajustes" description="Configuración de la instalación." />
        <Alert tone="error" title="No se pudo cargar la configuración">
          {loadError ?? 'Respuesta inesperada.'}{' '}
          <button
            type="button"
            onClick={reload}
            className="cursor-pointer font-semibold underline underline-offset-2"
          >
            Reintentar
          </button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ajustes"
        description="Información institucional de la portada, secciones visibles y buscadores."
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {blockError ? <Alert tone="error" title="No se pudo completar">{blockError}</Alert> : null}

      <Card className="flex flex-col gap-5">
        <h2 className="text-xl font-bold text-ink">Secciones de la portada</h2>
        <p className="text-base text-ink-muted">
          Activa o desactiva cada sección y ordénalas. El sitio público se compone con lo que
          quede habilitado.
        </p>

        <ol className="flex flex-col gap-2">
          {sections.map((section, index) => (
            <li
              key={section.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
            >
              <span className="text-base font-semibold text-ink">
                {index + 1}. {sectionLabel(section.key)}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  className="min-h-9 px-3 py-1 text-sm"
                  disabled={index === 0 || busy !== null}
                  onClick={() => void moveSection(index, -1)}
                  aria-label={`Subir ${sectionLabel(section.key)}`}
                >
                  Subir
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-9 px-3 py-1 text-sm"
                  disabled={index === sections.length - 1 || busy !== null}
                  onClick={() => void moveSection(index, 1)}
                  aria-label={`Bajar ${sectionLabel(section.key)}`}
                >
                  Bajar
                </Button>
                <Button
                  variant={section.isEnabled ? 'secondary' : 'primary'}
                  className="min-h-9 px-3 py-1 text-sm"
                  loading={busy === `section-${section.key}`}
                  onClick={() => void toggleSection(section)}
                  aria-label={`${section.isEnabled ? 'Desactivar' : 'Activar'} ${sectionLabel(section.key)}`}
                >
                  {section.isEnabled ? 'Desactivar' : 'Activar'}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-xl font-bold text-ink">Información institucional</h2>
        <p className="text-base text-ink-muted">
          Estos datos componen la portada y el pie del sitio público. Los colores se aplican a
          toda la instalación.
        </p>

        <form className="flex flex-col gap-5" onSubmit={handleSaveInstitution} noValidate>
          <div className="grid gap-5 md:grid-cols-2">
            <TextField
              id="inst-name"
              label="Nombre oficial"
              value={institution.name}
              onChange={(event) => patchInstitution('name', event.target.value)}
            />
            <TextField
              id="inst-number"
              label="Número o denominación"
              hint="Por ejemplo: Segunda Compañía."
              value={institution.number}
              onChange={(event) => patchInstitution('number', event.target.value)}
            />
          </div>

          <RichTextEditor
            id="inst-description"
            label="Presentación"
            value={institution.description}
            onChange={(html) => patchInstitution('description', toPlainText(html, 1) ? html : '')}
          />
          <RichTextEditor
            id="inst-history"
            label="Historia"
            value={institution.history}
            onChange={(html) => patchInstitution('history', toPlainText(html, 1) ? html : '')}
          />
          <RichTextEditor
            id="inst-mission"
            label="Misión"
            value={institution.mission}
            onChange={(html) => patchInstitution('mission', toPlainText(html, 1) ? html : '')}
          />
          <RichTextEditor
            id="inst-vision"
            label="Visión"
            value={institution.vision}
            onChange={(html) => patchInstitution('vision', toPlainText(html, 1) ? html : '')}
          />
          <RichTextEditor
            id="inst-values"
            label="Valores"
            value={institution.values}
            onChange={(html) => patchInstitution('values', toPlainText(html, 1) ? html : '')}
          />
          <RichTextEditor
            id="inst-corps"
            label="Información del cuerpo de bomberos"
            hint="Opcional."
            value={institution.corpsInfo}
            onChange={(html) => patchInstitution('corpsInfo', toPlainText(html, 1) ? html : '')}
          />

          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="inst-primary" className="text-sm font-semibold text-ink">
                Color principal
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="inst-primary"
                  type="color"
                  value={institution.primaryColor || '#b91c1c'}
                  onChange={(event) => patchInstitution('primaryColor', event.target.value)}
                  className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-surface"
                />
                <input
                  aria-label="Color principal en hexadecimal"
                  value={institution.primaryColor}
                  onChange={(event) => patchInstitution('primaryColor', event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-base text-ink"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="inst-secondary" className="text-sm font-semibold text-ink">
                Color secundario
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="inst-secondary"
                  type="color"
                  value={institution.secondaryColor || '#111827'}
                  onChange={(event) => patchInstitution('secondaryColor', event.target.value)}
                  className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-surface"
                />
                <input
                  aria-label="Color secundario en hexadecimal"
                  value={institution.secondaryColor}
                  onChange={(event) => patchInstitution('secondaryColor', event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-base text-ink"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <ImageUploader
              csrfToken={csrfToken}
              label="Escudo"
              hint="Es la imagen principal de la portada y de la cabecera del sitio."
              value={institution.shieldObjectId}
              onChange={(objectId) => setInstitution({ ...institution, shieldObjectId: objectId })}
              scope="site"
              isPublic={true}
            />
            <ImageUploader
              csrfToken={csrfToken}
              label="Logotipo"
              hint="Opcional. Se usa en el pie de página."
              value={institution.logoObjectId}
              onChange={(objectId) => setInstitution({ ...institution, logoObjectId: objectId })}
              scope="site"
              isPublic={true}
            />
          </div>

          <ImageUploader
            csrfToken={csrfToken}
            label="Foto de portada"
            hint="Se muestra como fondo de la portada del sitio."
            value={institution.coverObjectId}
            onChange={(objectId) => setInstitution({ ...institution, coverObjectId: objectId })}
            scope="site"
            isPublic={true}
          />

          <div className="grid gap-5 md:grid-cols-2">
            <TextField
              id="inst-address"
              label="Dirección"
              value={institution.address}
              onChange={(event) => patchInstitution('address', event.target.value)}
            />
            <TextField
              id="inst-emergency"
              label="Número de emergencia"
              value={institution.emergencyNumber}
              onChange={(event) => patchInstitution('emergencyNumber', event.target.value)}
            />
            <TextField
              id="inst-region"
              label="Región"
              value={institution.region}
              onChange={(event) => patchInstitution('region', event.target.value)}
            />
            <TextField
              id="inst-commune"
              label="Comuna"
              value={institution.commune}
              onChange={(event) => patchInstitution('commune', event.target.value)}
            />
            <TextField
              id="inst-country"
              label="País"
              value={institution.country}
              onChange={(event) => patchInstitution('country', event.target.value)}
            />
          </div>

          <TextAreaField
            id="inst-phones"
            label="Teléfonos"
            hint="Uno por línea."
            rows={3}
            value={phones}
            onChange={(event) => setPhones(event.target.value)}
          />
          <TextAreaField
            id="inst-emails"
            label="Correos"
            hint="Uno por línea."
            rows={3}
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
          />
          <TextAreaField
            id="inst-specialties"
            label="Especialidades"
            hint="Una por línea. Por ejemplo: Rescate vehicular."
            rows={4}
            value={specialties}
            onChange={(event) => setSpecialties(event.target.value)}
          />
          <TextAreaField
            id="inst-socials"
            label="Redes sociales"
            hint="Una por línea con el formato: Nombre | https://enlace"
            rows={3}
            value={socials}
            onChange={(event) => setSocials(event.target.value)}
          />

          <fieldset className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line p-5">
            <legend className="px-2 text-base font-bold text-ink">Buscadores (SEO)</legend>
            <TextField
              id="seo-title"
              label="Título del sitio"
              value={seo.title}
              onChange={(event) => setSeo({ ...seo, title: event.target.value })}
            />
            <TextAreaField
              id="seo-description"
              label="Descripción del sitio"
              rows={3}
              value={seo.description}
              onChange={(event) => setSeo({ ...seo, description: event.target.value })}
            />
            <ImageUploader
              csrfToken={csrfToken}
              label="Imagen para redes sociales"
              hint="Se muestra al compartir el enlace del sitio."
              value={seo.ogImageObjectId}
              onChange={(objectId) => setSeo({ ...seo, ogImageObjectId: objectId })}
              scope="site"
              isPublic={true}
            />
            <CheckboxField
              id="seo-indexing"
              label="Permitir que los buscadores indexen el sitio"
              checked={seo.allowIndexing}
              onChange={(event) => setSeo({ ...seo, allowIndexing: event.target.checked })}
            />
          </fieldset>

          <div>
            <Button type="submit" loading={busy === 'institution'}>
              Guardar información institucional
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
