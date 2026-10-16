import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useRoute } from '../lib/router';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';

const MIN_PASSWORD_LENGTH = 12;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  administrador: 'Administrador',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network_error') {
      return 'No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.';
    }
    return error.message || 'Ocurrió un error inesperado.';
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

/** Formulario de cambio de contraseña obligatorio. */
function ForcedPasswordChange() {
  const { changePassword } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

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
    <div className="flex flex-col gap-4">
      <Alert tone="warning" title="Debes cambiar tu contraseña">
        Tu cuenta fue creada con una contraseña temporal. Define una nueva contraseña para
        continuar usando el sistema.
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
    </div>
  );
}

/** Página provisional tras iniciar sesión. */
export function DashboardPage() {
  const { user, logout } = useSession();
  const { navigate } = useRoute();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const displayName = user.displayName?.trim() || user.username;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  const logoutButton = (
    <Button variant="secondary" onClick={handleLogout} loading={loggingOut}>
      {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </Button>
  );

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6"
    >
      <PageHeader
        eyebrow="Panel"
        title={user.mustChangePassword ? 'Cambia tu contraseña' : `Hola, ${displayName}`}
        description={
          user.mustChangePassword
            ? undefined
            : 'Sesión iniciada en el Sistema de Gestión de tu institución.'
        }
        actions={logoutButton}
      />

      {user.mustChangePassword ? (
        <ForcedPasswordChange />
      ) : (
        <>
          <Card>
            <h2 className="mb-4 text-xl font-bold text-ink">Tu cuenta</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Usuario</dt>
                <dd className="text-base text-ink">{user.username}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm font-semibold text-ink-muted">Nombre para mostrar</dt>
                <dd className="text-base text-ink">{user.displayName ?? '—'}</dd>
              </div>
              <div className="flex flex-col sm:col-span-2">
                <dt className="text-sm font-semibold text-ink-muted">Roles</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {user.roles.length > 0 ? (
                    user.roles.map((role) => (
                      <span
                        key={role}
                        className="rounded-md border border-brand bg-brand/5 px-2 py-1 text-xs font-semibold text-brand"
                      >
                        {roleLabel(role)}
                      </span>
                    ))
                  ) : (
                    <span className="text-base text-ink-muted">Sin roles asignados</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col sm:col-span-2">
                <dt className="text-sm font-semibold text-ink-muted">Permisos</dt>
                <dd className="text-base text-ink">
                  {user.permissions.length > 0
                    ? `${user.permissions.length} permisos activos`
                    : 'Sin permisos asignados'}
                </dd>
              </div>
            </dl>
          </Card>

          <Alert tone="info" title="Próximamente">
            Los módulos de <strong>inventario</strong> y <strong>personal</strong> se incorporan en
            la siguiente fase del proyecto. Por ahora puedes administrar tu sesión.
          </Alert>
        </>
      )}
    </main>
  );
}
