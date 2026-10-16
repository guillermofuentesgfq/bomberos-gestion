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

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'unauthorized':
        return 'Usuario o contraseña incorrectos.';
      case 'too_many_requests':
        return error.message || 'Demasiados intentos. Espera unos minutos antes de reintentar.';
      case 'forbidden':
        return error.message || 'La cuenta no puede iniciar sesión.';
      default:
        return error.message;
    }
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

/** Formulario de acceso a la instalación. */
export function LoginPage() {
  const { login } = useSession();
  const { navigate } = useRoute();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await login(username.trim(), password);
      navigate('/panel');
    } catch (error) {
      setErrorMessage(messageForError(error));
      // El foco pasa al mensaje de error para que se anuncie y sea visible.
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-6"
    >
      <PageHeader
        eyebrow="Sistema de Gestión"
        title="Iniciar sesión"
        description="Accede con tu cuenta institucional para gestionar inventario y personal."
      />

      {errorMessage ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="error" title="No se pudo iniciar sesión">
            {errorMessage}
          </Alert>
        </div>
      ) : null}

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <TextField
            id="login-username"
            label="Usuario"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            id="login-password"
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </Card>

      <p className="text-sm text-ink-muted">
        Tras 5 intentos fallidos, la cuenta y la conexión quedan bloqueadas 15 minutos por
        seguridad.
      </p>
    </main>
  );
}
