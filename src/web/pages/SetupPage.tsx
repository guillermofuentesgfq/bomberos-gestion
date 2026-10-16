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

type FieldName = 'token' | 'username' | 'password' | 'confirm' | 'displayName';
type FieldErrors = Partial<Record<FieldName, string>>;

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MIN_PASSWORD_LENGTH = 12;

const FIELD_ORDER: FieldName[] = ['token', 'username', 'password', 'confirm', 'displayName'];
const FIELD_IDS: Record<FieldName, string> = {
  token: 'setup-token',
  username: 'setup-username',
  password: 'setup-password',
  confirm: 'setup-confirm',
  displayName: 'setup-display-name',
};

function validate(values: {
  token: string;
  username: string;
  password: string;
  confirm: string;
  displayName: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (values.token.trim().length === 0) {
    errors.token = 'Falta el token de inicialización.';
  }

  const username = values.username.trim();
  if (username.length === 0) {
    errors.username = 'Ingresa un nombre de usuario.';
  } else if (username.length < 3) {
    errors.username = 'El usuario debe tener al menos 3 caracteres.';
  } else if (username.length > 64) {
    errors.username = 'El usuario es demasiado largo.';
  } else if (!USERNAME_PATTERN.test(username)) {
    errors.username = 'Solo letras, números, punto, guion y guion bajo.';
  }

  if (values.password.length === 0) {
    errors.password = 'Ingresa una contraseña.';
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  } else if (values.password.length > 256) {
    errors.password = 'La contraseña es demasiado larga.';
  }

  if (values.confirm.length === 0) {
    errors.confirm = 'Repite la contraseña.';
  } else if (values.confirm !== values.password) {
    errors.confirm = 'Las contraseñas no coinciden.';
  }

  if (values.displayName.trim().length > 120) {
    errors.displayName = 'El nombre para mostrar es demasiado largo.';
  }

  return errors;
}

function focusField(name: FieldName): void {
  const element = document.getElementById(FIELD_IDS[name]);
  if (element instanceof HTMLElement) element.focus();
}

/** Asistente de inicialización del primer administrador. */
export function SetupPage() {
  const { setup } = useSession();
  const { navigate } = useRoute();

  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);

    const values = { token, username, password, confirm, displayName };
    const errors = validate(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstInvalid = FIELD_ORDER.find((name) => errors[name]);
      if (firstInvalid) focusField(firstInvalid);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await setup({
        token: token.trim(),
        username: username.trim(),
        password,
        displayName: displayName.trim(),
      });
      navigate('/panel');
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        const mapped: FieldErrors = {};
        for (const issue of error.issues) {
          if (issue.path in FIELD_IDS) mapped[issue.path as FieldName] = issue.message;
        }
        setFieldErrors(mapped);
        setGeneralError(error.message);
      } else if (error instanceof ApiError) {
        setGeneralError(error.message);
      } else {
        setGeneralError('Ocurrió un error inesperado. Inténtalo de nuevo.');
      }
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 p-6"
    >
      <PageHeader
        title="Crear administrador"
        description="Esta instalación todavía no tiene usuarios. Crea la cuenta de administración inicial."
      />

      <Alert tone="info" title="¿De dónde sale el token?">
        Copia el <strong>token de inicialización</strong> desde la variable de entorno{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">BOOTSTRAP_TOKEN</code> de la
        instalación. Solo se usa una vez: sirve para habilitar la creación del primer
        administrador.
      </Alert>

      {generalError ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo completar la configuración">
            {generalError}
          </Alert>
        </div>
      ) : null}

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <TextField
            id={FIELD_IDS.token}
            label="Token de inicialización"
            name="token"
            hint="Valor de BOOTSTRAP_TOKEN entregado en la instalación."
            autoComplete="off"
            spellCheck={false}
            required
            value={token}
            error={fieldErrors.token}
            onChange={(event) => setToken(event.target.value)}
          />
          <TextField
            id={FIELD_IDS.username}
            label="Usuario"
            name="username"
            hint="Mínimo 3 caracteres. Solo letras, números, punto, guion y guion bajo."
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            error={fieldErrors.username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            id={FIELD_IDS.displayName}
            label="Nombre para mostrar"
            name="displayName"
            hint="Opcional. Aparecerá en el panel en lugar del usuario."
            autoComplete="name"
            value={displayName}
            error={fieldErrors.displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <TextField
            id={FIELD_IDS.password}
            label="Contraseña"
            type="password"
            name="new-password"
            hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
            autoComplete="new-password"
            required
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            id={FIELD_IDS.confirm}
            label="Confirmar contraseña"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirm}
            error={fieldErrors.confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Creando administrador…' : 'Crear administrador'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
