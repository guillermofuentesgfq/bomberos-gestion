/**
 * Editor de texto enriquecido sin dependencias.
 *
 * El área editable es `contenteditable` **no controlada**: React nunca escribe
 * su contenido directamente (eso rompería el cursor), sino que se sincroniza
 * `value` → `innerHTML` solo cuando el valor difiere del DOM y el editor no
 * tiene el foco. Los comandos se ejecutan con `document.execCommand`, obsoleto
 * pero soportado por todos los navegadores actuales y suficiente para una lista
 * blanca pequeña de formato (`p, br, strong, em, u, s, h2, h3, h4, ul, ol, li,
 * blockquote, a, code, pre, hr`; `<b>`/`<i>` se normalizan a `<strong>`/`<em>`).
 *
 * El pegado se fuerza a texto plano para no arrastrar marcado ajeno; el
 * saneado definitivo lo hace el servidor al guardar.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ClipboardEvent, JSX } from 'react';
import { cx } from '../lib/cx';

export interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  /** Solo formato en línea (negrita, cursiva, enlace). Para resúmenes. */
  inline?: boolean | undefined;
}

/** Esquema presente en una URL (`https:`, `mailto:`, …). */
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Valida un enlace con el mismo criterio que el saneado del servidor: esquemas
 * `http`, `https`, `mailto` o `tel`, o una ruta relativa (`/`, `#`, `./`, `../`)
 * sin esquema. Rechaza cualquier otro esquema (por ejemplo `javascript:`).
 */
export function isValidLink(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0) return false;
  if (
    value.startsWith('/') ||
    value.startsWith('#') ||
    value.startsWith('./') ||
    value.startsWith('../')
  ) {
    return true;
  }
  const match = SCHEME_PATTERN.exec(value);
  if (!match) return true; // sin esquema → ruta relativa
  const scheme = match[1];
  return scheme !== undefined && ALLOWED_SCHEMES.has(scheme.toLocaleLowerCase());
}

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  h2: boolean;
  h3: boolean;
  blockquote: boolean;
  unordered: boolean;
  ordered: boolean;
  link: boolean;
}

const EMPTY_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  h2: false,
  h3: false,
  blockquote: false,
  unordered: false,
  ordered: false,
  link: false,
};

function statesEqual(a: FormatState, b: FormatState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.h2 === b.h2 &&
    a.h3 === b.h3 &&
    a.blockquote === b.blockquote &&
    a.unordered === b.unordered &&
    a.ordered === b.ordered &&
    a.link === b.link
  );
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

/** Enlace que contiene la selección, si está dentro del editor. */
function selectedAnchor(editor: HTMLElement): HTMLAnchorElement | null {
  const selection = window.getSelection();
  const element = elementOf(selection?.anchorNode ?? null);
  const anchor = element?.closest('a');
  if (anchor && anchor instanceof HTMLAnchorElement && editor.contains(anchor)) return anchor;
  return null;
}

interface ToolButtonProps {
  label: string;
  pressed?: boolean | undefined;
  onClick: () => void;
  children: JSX.Element | string;
}

function ToolButton({ label, pressed, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-9 items-center justify-center rounded-md border px-2 text-sm font-semibold transition-colors duration-200 ease-out',
        pressed
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-line bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  label,
  value,
  onChange,
  id,
  hint,
  error,
  required,
  inline = false,
}: RichTextEditorProps): JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const linkFieldId = `${fieldId}-link`;

  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  const [state, setState] = useState<FormatState>(EMPTY_STATE);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const describedBy = cx(hint ? hintId : null, error ? errorId : null) || undefined;

  // Sincroniza value → innerHTML solo si difiere y el editor no tiene el foco.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    if (editor.innerHTML === value) return;
    editor.innerHTML = value;
  }, [value]);

  const refreshFormatState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const hasFocus =
      document.activeElement === editor ||
      (anchor !== null && editor.contains(anchor));

    if (!hasFocus) {
      setState((prev) => (statesEqual(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
      return;
    }

    const block = (document.queryCommandValue('formatBlock') || '').toLocaleLowerCase();
    const next: FormatState = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      h2: block === 'h2',
      h3: block === 'h3',
      blockquote: block === 'blockquote',
      unordered: document.queryCommandState('insertUnorderedList'),
      ordered: document.queryCommandState('insertOrderedList'),
      link: selectedAnchor(editor) !== null,
    };
    setState((prev) => (statesEqual(prev, next) ? prev : next));
  }, []);

  // Refresca el estado de los botones al mover la selección; limpia al desmontar.
  useEffect(() => {
    document.addEventListener('selectionchange', refreshFormatState);
    return () => document.removeEventListener('selectionchange', refreshFormatState);
  }, [refreshFormatState]);

  function emitChange(): void {
    const editor = editorRef.current;
    if (editor) onChange(editor.innerHTML);
  }

  function runCommand(command: string, argument?: string): void {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, argument);
    emitChange();
    refreshFormatState();
  }

  function toggleBlock(tag: 'h2' | 'h3' | 'blockquote'): void {
    const current = (document.queryCommandValue('formatBlock') || '').toLocaleLowerCase();
    runCommand('formatBlock', current === tag ? 'p' : tag);
  }

  function handleInput(): void {
    emitChange();
    refreshFormatState();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emitChange();
    refreshFormatState();
  }

  function openLinkField(): void {
    if (linkOpen) {
      setLinkOpen(false);
      setLinkError(null);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
    setLinkValue(selectedAnchor(editor)?.getAttribute('href') ?? '');
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink(): void {
    const raw = linkValue.trim();
    if (!isValidLink(raw)) {
      setLinkError('Escribe una dirección válida: http, https, mailto, tel o una ruta del sitio.');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    const saved = savedRangeRef.current;
    if (selection && saved) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    document.execCommand('createLink', false, raw);
    savedRangeRef.current = null;
    setLinkOpen(false);
    setLinkValue('');
    setLinkError(null);
    emitChange();
    refreshFormatState();
  }

  function removeLink(): void {
    savedRangeRef.current = null;
    setLinkOpen(false);
    setLinkError(null);
    runCommand('unlink');
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-semibold text-ink">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>

      <div
        className={cx(
          'rounded-lg border bg-surface transition-colors duration-200 ease-out',
          error ? 'border-destructive' : 'border-line',
          'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand',
        )}
      >
        <div
          role="toolbar"
          aria-label={`Formato de ${label}`}
          className="flex flex-wrap gap-1 rounded-t-lg border-b border-line bg-muted p-2"
        >
          <ToolButton
            label="Negrita"
            pressed={state.bold}
            onClick={() => runCommand('bold')}
          >
            <span className="font-bold">Negrita</span>
          </ToolButton>
          <ToolButton
            label="Cursiva"
            pressed={state.italic}
            onClick={() => runCommand('italic')}
          >
            <span className="italic">Cursiva</span>
          </ToolButton>

          {inline ? null : (
            <>
              <ToolButton
                label="Subrayado"
                pressed={state.underline}
                onClick={() => runCommand('underline')}
              >
                <span className="underline">Subrayado</span>
              </ToolButton>
              <ToolButton label="Título 2" pressed={state.h2} onClick={() => toggleBlock('h2')}>
                Título 2
              </ToolButton>
              <ToolButton label="Título 3" pressed={state.h3} onClick={() => toggleBlock('h3')}>
                Título 3
              </ToolButton>
              <ToolButton
                label="Lista con viñetas"
                pressed={state.unordered}
                onClick={() => runCommand('insertUnorderedList')}
              >
                Viñetas
              </ToolButton>
              <ToolButton
                label="Lista numerada"
                pressed={state.ordered}
                onClick={() => runCommand('insertOrderedList')}
              >
                Numerada
              </ToolButton>
              <ToolButton
                label="Cita"
                pressed={state.blockquote}
                onClick={() => toggleBlock('blockquote')}
              >
                Cita
              </ToolButton>
            </>
          )}

          <ToolButton
            label="Enlace"
            pressed={state.link || linkOpen}
            onClick={openLinkField}
          >
            Enlace
          </ToolButton>
          <ToolButton label="Quitar enlace" onClick={removeLink}>
            Quitar enlace
          </ToolButton>
          <ToolButton
            label="Limpiar formato"
            onClick={() => runCommand('removeFormat')}
          >
            Limpiar formato
          </ToolButton>
        </div>

        {linkOpen ? (
          <div className="flex flex-col gap-2 border-b border-line bg-muted p-2">
            <label htmlFor={linkFieldId} className="text-sm font-semibold text-ink">
              Dirección del enlace
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={linkFieldId}
                type="text"
                inputMode="url"
                value={linkValue}
                placeholder="https://ejemplo.cl o /pagina"
                onChange={(event) => {
                  setLinkValue(event.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyLink();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setLinkOpen(false);
                    setLinkValue('');
                    setLinkError(null);
                  }
                }}
                aria-invalid={linkError ? true : undefined}
                className={cx(
                  'min-h-9 min-w-56 flex-1 rounded-md border bg-surface px-3 py-1 text-base text-ink',
                  linkError ? 'border-destructive' : 'border-line',
                )}
              />
              <button
                type="button"
                onClick={applyLink}
                className="inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-accent-strong"
              >
                Aplicar enlace
              </button>
            </div>
            {linkError ? (
              <p className="text-sm font-medium text-destructive">{linkError}</p>
            ) : null}
          </div>
        ) : null}

        <div
          ref={editorRef}
          id={fieldId}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          onBlur={refreshFormatState}
          onKeyUp={refreshFormatState}
          onMouseUp={refreshFormatState}
          className="min-h-11 w-full rounded-b-lg px-4 py-3 text-base text-ink focus:outline-none"
        />
      </div>

      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
