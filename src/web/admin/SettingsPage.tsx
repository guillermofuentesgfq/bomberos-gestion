/**
 * Ajustes de la instalación.
 *
 * Tres bloques: catálogo del inventario (ubicaciones y categorías), contenido
 * de la portada (datos institucionales y SEO) y secciones de la portada
 * (activar, desactivar y ordenar).
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { errorMessage } from './adminApi';
import { CheckboxField, StatusMessage, TextAreaField } from './adminFields';
import {
  createCategory,
  createLocation,
  fetchCatalog,
  fetchInstitutionSettings,
  fetchSections,
  reorderSections,
  updateInstitution,
  updateSection,
  updateSeo,
  type CatalogOption,
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

  const [locations, setLocations] = useState<CatalogOption[]>([]);
  const [categories, setCategories] = useState<CatalogOption[]>([]);
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

  const [newLocation, setNewLocation] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([fetchInstitutionSettings(), fetchSections(), fetchCatalog()])
      .then(([settings, siteSections, catalog]) => {
        if (cancelled) return;
        setInstitution(settings.institution);
        setSeo(settings.seo);
        setPhones(listToLines(settings.institution.phones));
        setEmails(listToLines(settings.institution.emails));
        setSpecialties(listToLines(settings.institution.specialties));
        setSocials(socialsToText(settings.institution.socials));
        setSections([...siteSections].sort((a, b) => a.sortOrder - b.sortOrder));
        setLocations(catalog.locations);
        setCategories(catalog.categories);
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
        { title: seo.title, description: seo.description, allowIndexing: seo.allowIndexing },
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

  async function handleAddLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newLocation.trim();
    if (!name || busy) return;
    setBusy('location');
    setBlockError(null);
    setNotice(null);
    try {
      await createLocation(name, null, csrfToken);
      setNewLocation('');
      setNotice(`Ubicación «${name}» agregada.`);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict') {
        setBlockError('Esa ubicación ya existe.');
      } else {
        setBlockError(errorMessage(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleAddCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name || busy) return;
    setBusy('category');
    setBlockError(null);
    setNotice(null);
    try {
      await createCategory(name, csrfToken);
      setNewCategory('');
      setNotice(`Categoría «${name}» agregada.`);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict') {
        setBlockError('Esa categoría ya existe.');
      } else {
        setBlockError(errorMessage(cause));
      }
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
        description="Ubicaciones y categorías del inventario, datos institucionales de la portada y secciones visibles."
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {blockError ? <Alert tone="error" title="No se pudo completar">{blockError}</Alert> : null}

      <Card className="flex flex-col gap-5">
        <h2 className="text-xl font-bold text-ink">Catálogo del inventario</h2>
        <p className="text-base text-ink-muted">
          Sin ubicaciones no se puede registrar ni mover material: créalas antes de cargar el
          inventario.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-ink">Ubicaciones</h3>
            {locations.length === 0 ? (
              <StatusMessage>Todavía no hay ubicaciones.</StatusMessage>
            ) : (
              <ul className="flex flex-col gap-1">
                {locations.map((location) => (
                  <li key={location.id} className="rounded-md border border-line px-3 py-2 text-base text-ink">
                    {location.name}
                  </li>
                ))}
              </ul>
            )}
            <form className="flex flex-col gap-3" onSubmit={handleAddLocation} noValidate>
              <TextField
                id="new-location"
                label="Nueva ubicación"
                hint="Por ejemplo: Bodega, Sala de estar, BX-2, Taller."
                value={newLocation}
                onChange={(event) => setNewLocation(event.target.value)}
              />
              <div>
                <Button type="submit" loading={busy === 'location'}>
                  Agregar ubicación
                </Button>
              </div>
            </form>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-ink">Categorías</h3>
            {categories.length === 0 ? (
              <StatusMessage>Todavía no hay categorías.</StatusMessage>
            ) : (
              <ul className="flex flex-col gap-1">
                {categories.map((category) => (
                  <li key={category.id} className="rounded-md border border-line px-3 py-2 text-base text-ink">
                    {category.name}
                  </li>
                ))}
              </ul>
            )}
            <form className="flex flex-col gap-3" onSubmit={handleAddCategory} noValidate>
              <TextField
                id="new-category"
                label="Nueva categoría"
                hint="Por ejemplo: EPP, Extinción, Rescate."
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
              />
              <div>
                <Button type="submit" loading={busy === 'category'}>
                  Agregar categoría
                </Button>
              </div>
            </form>
          </section>
        </div>
      </Card>

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

          <TextAreaField
            id="inst-description"
            label="Presentación"
            rows={3}
            value={institution.description}
            onChange={(event) => patchInstitution('description', event.target.value)}
          />
          <TextAreaField
            id="inst-history"
            label="Historia"
            rows={5}
            value={institution.history}
            onChange={(event) => patchInstitution('history', event.target.value)}
          />
          <TextAreaField
            id="inst-mission"
            label="Misión"
            rows={3}
            value={institution.mission}
            onChange={(event) => patchInstitution('mission', event.target.value)}
          />
          <TextAreaField
            id="inst-vision"
            label="Visión"
            rows={3}
            value={institution.vision}
            onChange={(event) => patchInstitution('vision', event.target.value)}
          />
          <TextAreaField
            id="inst-values"
            label="Valores"
            rows={3}
            value={institution.values}
            onChange={(event) => patchInstitution('values', event.target.value)}
          />
          <TextAreaField
            id="inst-corps"
            label="Información del cuerpo de bomberos"
            hint="Opcional."
            rows={3}
            value={institution.corpsInfo}
            onChange={(event) => patchInstitution('corpsInfo', event.target.value)}
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
