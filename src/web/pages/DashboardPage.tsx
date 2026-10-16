import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';

const MIN_PASSWORD_LENGTH = 12;

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network_error') {
      return 'No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.';
    }
    return error.message || 'Ocurrió un error inesperado.';
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

/**
 * Paso obligatorio de cambio de contraseña.
 *
 * Mientras `mustChangePassword` esté activo, la API bloquea el resto de
 * operaciones, así que esta pantalla se interpone antes del panel.
 */
export function DashboardPage() {
  const { user, changePassword, logout } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const displayName = user?.displayName?.trim() || user?.username || '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);
    setCurrentError(null);
    setNewError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setNewError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirm) {
      setNewError('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (newPassword === currentPassword) {
      setNewError('La nueva contraseña debe ser distinta de la actual.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'forbidden') setCurrentError(error.message);
        else if (error.code === 'unprocessable_entity') setNewError(error.message);
        else setGeneralError(messageForError(error));
      } else {
        setGeneralError(messageForError(error));
      }
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 p-6"
    >
      <PageHeader
        title="Cambia tu contraseña"
        description={`Hola${displayName ? `, ${displayName}` : ''}: define una contraseña propia antes de entrar al panel.`}
        actions={
          <Button variant="secondary" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        }
      />

      <Alert tone="warning" title="Contraseña temporal">
        Tu cuenta fue creada con una contraseña temporal. Define una nueva para continuar.
      </Alert>

      {generalError ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo cambiar la contraseña">
            {generalError}
          </Alert>
        </div>
      ) : null}

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <TextField
            id="password-current"
            label="Contraseña actual"
            type="password"
            name="current-password"
            autoComplete="current-password"
            required
            value={currentPassword}
            error={currentError ?? undefined}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <TextField
            id="password-new"
            label="Nueva contraseña"
            type="password"
            name="new-password"
            hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres y distinta de la actual.`}
            autoComplete="new-password"
            required
            value={newPassword}
            error={newError ?? undefined}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <TextField
            id="password-confirm"
            label="Confirmar nueva contraseña"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Guardando…' : 'Cambiar contraseña'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
