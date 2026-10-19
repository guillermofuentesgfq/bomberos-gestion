/**
 * Ajustes → Notificaciones (bot de Telegram).
 *
 * Quien administra la instalación habilita el bot **desde aquí**, sin tocar la
 * línea de comandos: pega el token que le dio BotFather, el identificador del
 * grupo y prueba el envío. El token se guarda cifrado y esta pantalla nunca lo
 * recupera: si se pierde, se vuelve a pegar.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { errorMessage } from './adminApi';
import { StatusMessage } from './adminFields';
import {
  clearTelegramToken,
  fetchNotifications,
  saveTelegram,
  testTelegram,
  type NotificationState,
} from './importApi';

export function NotificationsSettings({ csrfToken }: { csrfToken: string }) {
  const [state, setState] = useState<NotificationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState('');
  const [includeContact, setIncludeContact] = useState(false);
  const [token, setToken] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await fetchNotifications();
      setState(data);
      setEnabled(data.settings.enabled);
      setChatId(data.settings.chatId);
      setIncludeContact(data.settings.includeContact);
      setToken('');
    } catch (caught) {
      setLoadError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <Card>
        <h2 className="text-xl font-bold text-ink">Notificaciones</h2>
        <div className="mt-3">
          <Alert tone="error">{loadError}</Alert>
        </div>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card>
        <h2 className="text-xl font-bold text-ink">Notificaciones</h2>
        <StatusMessage>Cargando la configuración…</StatusMessage>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-ink">Notificaciones</h2>
        <p className="max-w-[70ch] text-base text-ink-muted">
          La instalación no envía correo. Cuando llega una postulación nueva, un bot publica el
          aviso en el grupo de Telegram que indiques. El token se guarda cifrado y nunca se
          muestra de vuelta.
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <TextField
          id="telegram-chat"
          label="Identificador del grupo"
          hint="Por ejemplo: -1001234567890. Se obtiene reenviando un mensaje del grupo a @userinfobot."
          value={chatId}
          onChange={(event) => setChatId(event.target.value)}
        />
        <TextField
          id="telegram-token"
          label="Token del bot"
          type="password"
          autoComplete="off"
          hint={
            state.settings.hasToken
              ? 'Ya hay un token guardado. Déjalo en blanco para conservarlo.'
              : 'Lo entrega BotFather al crear el bot. Solo se guarda; no se muestra.'
          }
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
        <input
          type="checkbox"
          checked={includeContact}
          onChange={(event) => setIncludeContact(event.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
        />
        <span className="font-semibold">
          Incluir teléfono y correo del postulante en el aviso
        </span>
      </label>
      <p className="-mt-3 text-sm text-ink-muted">
        El grupo de Telegram es un servicio externo. Si lo dejas desactivado, el aviso lleva solo
        el nombre, la comuna y un enlace al panel.
      </p>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
        />
        <span className="font-semibold">Bot activado</span>
      </label>

      <div className="flex flex-wrap gap-3">
        <Button
          loading={busy === 'save'}
          onClick={() =>
            void run(
              'save',
              () =>
                saveTelegram(
                  {
                    enabled,
                    chatId,
                    includeContact,
                    ...(token.trim().length > 0 ? { token: token.trim() } : {}),
                  },
                  csrfToken,
                ),
              'Configuración guardada.',
            )
          }
        >
          Guardar
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'test'}
          onClick={() => void run('test', () => testTelegram(csrfToken), 'Mensaje de prueba enviado.')}
        >
          Enviar mensaje de prueba
        </Button>
        {state.settings.hasToken ? (
          <Button
            variant="secondary"
            loading={busy === 'clear'}
            onClick={() =>
              void run('clear', () => clearTelegramToken(csrfToken), 'Token eliminado y bot desactivado.')
            }
          >
            Eliminar token
          </Button>
        ) : null}
      </div>

      {state.settings.lastError ? (
        <Alert tone="warning" title="Último error de envío">
          {state.settings.lastError}
          {state.settings.lastErrorAt ? (
            <span className="block text-sm text-ink-muted">
              {new Date(state.settings.lastErrorAt).toLocaleString('es-CL')}
            </span>
          ) : null}
        </Alert>
      ) : state.settings.lastSuccessAt ? (
        <p className="text-sm text-ink-muted">
          Último envío correcto: {new Date(state.settings.lastSuccessAt).toLocaleString('es-CL')}
        </p>
      ) : null}

      {state.log.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-base font-semibold text-ink">
            Historial de envíos
          </summary>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {state.log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-2 border-b border-line/60 pb-2">
                <span className="font-semibold text-ink">{entry.status}</span>
                <span className="text-ink-muted">{entry.event}</span>
                <span className="text-ink-muted">
                  {new Date(entry.created_at).toLocaleString('es-CL')}
                </span>
                {entry.detail ? <span className="text-ink-muted">{entry.detail}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
