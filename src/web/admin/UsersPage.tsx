/**
 * Usuarios del panel.
 *
 * Única pantalla para gestionar las cuentas que pueden ingresar al panel y sus
 * roles. Reúne el listado con edición en línea (una fila a la vez, con
 * `aria-expanded`), el alta de usuarios, el restablecimiento de contraseñas, el
 * desbloqueo tras intentos fallidos y el archivado con confirmación en dos
 * pasos (no borra: archiva). Los roles se muestran aparte, en solo lectura, con
 * los permisos que conceden.
 *
 * Las reglas del servidor se reflejan en la interfaz: no se puede desactivar ni
 * archivar la propia cuenta ni quitarse el rol de administrador, y tampoco se
 * puede desactivar ni archivar la última cuenta administradora activa. Cuando
 * el servidor rechaza una acción, su mensaje se muestra tal cual.
 */

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { cx } from '../lib/cx';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { CheckboxField, StatusMessage } from './adminFields';
import {
  archiveUser,
  createUser,
  errorMessage,
  fetchUsers,
  resetUserPassword,
  unlockUser,
  updateUser,
} from './adminApi';
import type { RoleSummary, UserSummary, UsersPayload } from './adminApi';

/**
 * Longitud mínima de contraseña del servidor.
 *
 * El Worker la define y la exporta en `security/passwords.ts`, pero ese módulo
 * es del Worker y no se importa desde el panel. Se repite aquí el mismo valor
 * (12) tal como ya hacen `SetupPage` y `DashboardPage`.
 */
const MIN_PASSWORD_LENGTH = 12;

/** Rol con acceso completo; el servidor protege las cuentas que lo tienen. */
const ADMIN_ROLE = 'admin';

/** Regla del servidor para los nombres de usuario. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Santiago',
});

/** Último ingreso legible, o el aviso de que nunca ha ingresado. */
function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Nunca ha ingresado';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Nunca ha ingresado';
  return DATE_TIME_FORMATTER.format(date);
}

/**
 * Descripción en español de cada permiso, atada a los códigos de
 * `migrations/0002_reference_data.sql`. Si el servidor concede un permiso que
 * no está en este mapa, se muestra su código tal cual para no ocultar nada.
 */
const PERMISSION_LABELS: Record<string, string> = {
  'institution.read': 'Ver la configuración institucional',
  'institution.write': 'Modificar la configuración institucional',
  'users.read': 'Ver usuarios y roles',
  'users.write': 'Crear y modificar usuarios',
  'roles.write': 'Modificar roles y permisos',
  'inventory.read': 'Consultar inventario y movimientos',
  'inventory.write': 'Crear y editar materiales, unidades y catálogos',
  'inventory.assign': 'Registrar entregas de material',
  'inventory.return': 'Registrar devoluciones de material',
  'inventory.transfer': 'Registrar traslados entre ubicaciones',
  'inventory.writeoff': 'Registrar bajas de material',
  'inventory.maintenance': 'Registrar mantenciones y revisiones',
  'inventory.import': 'Importar y catastrar material',
  'inventory.export': 'Exportar informes y planillas',
  'persons.read': 'Consultar fichas de personal',
  'persons.write': 'Crear y editar fichas de personal y cargos',
  'site.read': 'Ver el contenido del sitio público',
  'site.write': 'Crear y editar contenido del sitio',
  'site.publish': 'Publicar, despublicar y archivar contenido',
  'audit.read': 'Consultar el registro de auditoría',
};

function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code;
}

/** Nombre del rol a partir de su código; si no aparece, se muestra el código. */
function roleName(roles: readonly RoleSummary[], code: string): string {
  return roles.find((role) => role.code === code)?.name ?? code;
}

/** Marca o desmarca un rol sin mutar la lista recibida. */
function toggleRole(selected: readonly string[], code: string): string[] {
  return selected.includes(code)
    ? selected.filter((value) => value !== code)
    : [...selected, code];
}

/**
 * Motivo por el que una cuenta tiene acciones restringidas, o `null` si no
 * tiene ninguna. Se muestra junto a los controles deshabilitados.
 */
function userRestriction(isSelf: boolean, isLastAdmin: boolean): string | null {
  if (isSelf && isLastAdmin) {
    return 'Es tu cuenta y la única cuenta administradora activa. No puedes quitarte el rol de administrador ni desactivar o archivar tu cuenta desde aquí.';
  }
  if (isSelf) {
    return 'Es tu propia cuenta. No puedes quitarte el rol de administrador ni desactivar o archivar tu cuenta desde aquí.';
  }
  if (isLastAdmin) {
    return 'Es la única cuenta administradora activa. No se puede desactivar ni archivar.';
  }
  return null;
}

type PillTone = 'active' | 'inactive' | 'warning' | 'danger';

const PILL_CLASSES: Record<PillTone, string> = {
  active: 'border-emerald-700 bg-emerald-600/10 text-ink',
  inactive: 'border-line bg-muted text-ink-muted',
  warning: 'border-amber-600 bg-amber-500/10 text-ink',
  danger: 'border-destructive bg-destructive/10 text-ink',
};

/** Distintivo de estado. Los colores siguen los mismos tonos que `Alert`. */
function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        PILL_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Selección de roles con casillas agrupadas en un `fieldset` con leyenda, para
 * que la agrupación se anuncie. Cada casilla lleva su propia etiqueta y, como
 * ayuda, la descripción del rol: así se ve qué se está otorgando. Los roles
 * bloqueados (`isLocked`) quedan deshabilitados con su explicación.
 */
function RoleChecklist({
  roles,
  selected,
  onToggle,
  disabled = false,
  isLocked,
  lockedHint,
}: {
  roles: readonly RoleSummary[];
  selected: readonly string[];
  onToggle: (code: string) => void;
  disabled?: boolean | undefined;
  isLocked?: ((code: string) => boolean) | undefined;
  lockedHint?: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="text-sm font-semibold text-ink">Roles</legend>
      <p className="text-sm text-ink-muted">
        Marca los roles que tendrá la cuenta. Al asignar un rol, la cuenta recibe
        todos los permisos que ese rol concede (se detallan en la tarjeta
        «Roles»).
      </p>
      {roles.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay roles configurados.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {roles.map((role) => {
            const locked = isLocked?.(role.code) ?? false;
            const hint = locked ? lockedHint : (role.description ?? undefined);
            return (
              <CheckboxField
                key={role.code}
                label={`${role.name} (${role.code})`}
                checked={selected.includes(role.code)}
                disabled={locked || disabled}
                hint={hint}
                onChange={() => onToggle(role.code)}
              />
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

type PanelKind = 'edit' | 'reset' | 'archive';

/**
 * Listado de cuentas con edición en línea, restablecimiento de contraseña,
 * desbloqueo y archivado. Solo un panel está abierto a la vez y las acciones de
 * una fila se bloquean mientras otra está en curso, para no enviar dos veces.
 */
function UsersCard({
  users,
  roles,
  csrfToken,
  selfUserId,
  onChanged,
  onNotice,
  onError,
}: {
  users: readonly UserSummary[];
  roles: readonly RoleSummary[];
  csrfToken: string;
  selfUserId: number | null;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [panel, setPanel] = useState<{ id: number; kind: PanelKind } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [resetPassword, setResetPassword] = useState('');

  const lastActiveAdminId = useMemo(() => {
    const activeAdmins = users.filter(
      (user) => user.isActive && user.roles.includes(ADMIN_ROLE),
    );
    return activeAdmins.length === 1 ? (activeAdmins[0]?.id ?? null) : null;
  }, [users]);

  const busy = pendingId !== null;

  function closePanel() {
    setPanel(null);
  }

  function startEdit(user: UserSummary) {
    setPanel({ id: user.id, kind: 'edit' });
    setEditDisplayName(user.displayName ?? '');
    setEditEmail(user.email ?? '');
    setEditIsActive(user.isActive);
    setEditRoles([...user.roles]);
    onError(null);
    onNotice(null);
  }

  function startReset(user: UserSummary) {
    setPanel({ id: user.id, kind: 'reset' });
    setResetPassword('');
    onError(null);
    onNotice(null);
  }

  function startArchive(user: UserSummary) {
    setPanel({ id: user.id, kind: 'archive' });
    onError(null);
    onNotice(null);
  }

  async function handleSave(user: UserSummary) {
    if (pendingId) return;
    setPendingId(`save-${user.id}`);
    onError(null);
    onNotice(null);
    try {
      await updateUser(
        user.id,
        {
          displayName: editDisplayName.trim() || null,
          email: editEmail.trim() || null,
          isActive: editIsActive,
          roles: editRoles,
        },
        csrfToken,
      );
      setPanel(null);
      onNotice(`Usuario «${user.username}» actualizado.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function handleReset(user: UserSummary) {
    if (pendingId) return;
    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      onError(
        `La contraseña temporal debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }
    setPendingId(`reset-${user.id}`);
    onError(null);
    onNotice(null);
    try {
      await resetUserPassword(user.id, { password: resetPassword }, csrfToken);
      setPanel(null);
      setResetPassword('');
      onNotice(
        `Contraseña de «${user.username}» restablecida. La persona deberá cambiarla en su próximo ingreso.`,
      );
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function handleUnlock(user: UserSummary) {
    if (pendingId) return;
    setPendingId(`unlock-${user.id}`);
    onError(null);
    onNotice(null);
    try {
      await unlockUser(user.id, csrfToken);
      onNotice(`Cuenta de «${user.username}» desbloqueada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function handleArchive(user: UserSummary) {
    if (pendingId) return;
    setPendingId(`archive-${user.id}`);
    onError(null);
    onNotice(null);
    try {
      await archiveUser(user.id, csrfToken);
      setPanel(null);
      onNotice(`Cuenta de «${user.username}» archivada.`);
      onChanged();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Cuentas con acceso al panel</h2>
      <p className="text-base text-ink-muted">
        Cada cuenta ingresa con su usuario y contraseña. Los roles definen qué
        puede hacer.
      </p>

      {users.length === 0 ? (
        <StatusMessage>Todavía no hay usuarios.</StatusMessage>
      ) : (
        <ul className="flex flex-col gap-3">
          {users.map((user) => {
            const isSelf = user.id === selfUserId;
            const isLastAdmin = user.id === lastActiveAdminId;
            const locksDeactivation = isSelf || isLastAdmin;
            const restriction = userRestriction(isSelf, isLastAdmin);
            const restrictionId = `user-restriction-${user.id}`;
            const openKind: PanelKind | null =
              panel !== null && panel.id === user.id ? panel.kind : null;
            const selfAdminLocked = isSelf;

            return (
              <li key={user.id} className="flex flex-col gap-3 rounded-md border border-line px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-ink">{user.username}</span>
                      <StatusPill tone={user.isActive ? 'active' : 'inactive'}>
                        {user.isActive ? 'Activo' : 'Inactivo'}
                      </StatusPill>
                      {user.locked ? <StatusPill tone="danger">Bloqueado</StatusPill> : null}
                      {user.mustChangePassword ? (
                        <StatusPill tone="warning">Debe cambiar contraseña</StatusPill>
                      ) : null}
                    </div>

                    {user.displayName ? (
                      <p className="text-base text-ink">{user.displayName}</p>
                    ) : (
                      <p className="text-sm text-ink-muted">Sin nombre para mostrar</p>
                    )}

                    <p className="text-sm text-ink-muted">
                      {user.email ? user.email : 'Sin correo'}
                    </p>

                    {user.roles.length > 0 ? (
                      <ul className="flex flex-wrap gap-2" aria-label={`Roles de ${user.username}`}>
                        {user.roles.map((code) => (
                          <li
                            key={code}
                            className="rounded-md border border-line bg-muted px-2 py-0.5 text-xs font-semibold text-ink"
                          >
                            {roleName(roles, code)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-ink-muted">Sin roles asignados.</p>
                    )}

                    <p className="text-sm text-ink-muted">
                      <span className="font-semibold">Último ingreso:</span>{' '}
                      {formatLastLogin(user.lastLoginAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-9 px-3 py-1 text-sm"
                      disabled={busy}
                      aria-expanded={openKind === 'edit'}
                      aria-label={`Editar la cuenta ${user.username}`}
                      onClick={() => (openKind === 'edit' ? closePanel() : startEdit(user))}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-9 px-3 py-1 text-sm"
                      disabled={busy}
                      aria-expanded={openKind === 'reset'}
                      aria-label={`Restablecer la contraseña de ${user.username}`}
                      onClick={() => (openKind === 'reset' ? closePanel() : startReset(user))}
                    >
                      Restablecer contraseña
                    </Button>
                    {user.locked ? (
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1 text-sm"
                        loading={pendingId === `unlock-${user.id}`}
                        disabled={busy && pendingId !== `unlock-${user.id}`}
                        aria-label={`Desbloquear la cuenta ${user.username}`}
                        onClick={() => void handleUnlock(user)}
                      >
                        Desbloquear
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      className="min-h-9 px-3 py-1 text-sm"
                      disabled={busy || locksDeactivation}
                      aria-expanded={openKind === 'archive'}
                      aria-describedby={restriction && locksDeactivation ? restrictionId : undefined}
                      aria-label={`Archivar la cuenta ${user.username}`}
                      onClick={() => (openKind === 'archive' ? closePanel() : startArchive(user))}
                    >
                      Archivar
                    </Button>
                  </div>
                </div>

                {restriction ? (
                  <p id={restrictionId} className="text-sm text-ink-muted">
                    {restriction}
                  </p>
                ) : null}

                {openKind === 'edit' ? (
                  <form
                    className="flex flex-col gap-3 border-t border-line pt-3"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSave(user);
                    }}
                  >
                    <TextField
                      label="Nombre para mostrar"
                      hint="Opcional. Cómo se verá la persona en el panel."
                      value={editDisplayName}
                      autoComplete="off"
                      onChange={(event) => setEditDisplayName(event.target.value)}
                    />
                    <TextField
                      label="Correo"
                      type="email"
                      hint="Opcional."
                      value={editEmail}
                      autoComplete="off"
                      onChange={(event) => setEditEmail(event.target.value)}
                    />
                    <CheckboxField
                      label="Cuenta activa"
                      checked={editIsActive}
                      disabled={locksDeactivation}
                      hint={
                        locksDeactivation
                          ? isSelf
                            ? 'No puedes desactivar tu propia cuenta.'
                            : 'Es la única cuenta administradora activa: no se puede desactivar.'
                          : 'Una cuenta inactiva no puede ingresar al panel.'
                      }
                      onChange={(event) => setEditIsActive(event.target.checked)}
                    />
                    <RoleChecklist
                      roles={roles}
                      selected={editRoles}
                      disabled={pendingId !== null}
                      isLocked={(code) => code === ADMIN_ROLE && selfAdminLocked}
                      lockedHint="No puedes quitarte el rol de administrador a tu propia cuenta."
                      onToggle={(code) => setEditRoles((previous) => toggleRole(previous, code))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        className="min-h-9 px-3 py-1 text-sm"
                        loading={pendingId === `save-${user.id}`}
                      >
                        Guardar cambios
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1 text-sm"
                        disabled={busy}
                        onClick={closePanel}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : null}

                {openKind === 'reset' ? (
                  <form
                    className="flex flex-col gap-3 border-t border-line pt-3"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleReset(user);
                    }}
                  >
                    <TextField
                      label={`Contraseña temporal para ${user.username}`}
                      type="password"
                      required
                      autoComplete="new-password"
                      hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. La persona deberá cambiarla en su próximo ingreso.`}
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        className="min-h-9 px-3 py-1 text-sm"
                        loading={pendingId === `reset-${user.id}`}
                      >
                        Restablecer contraseña
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1 text-sm"
                        disabled={busy}
                        onClick={closePanel}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : null}

                {openKind === 'archive' ? (
                  <div className="flex flex-col gap-2 border-t border-line pt-3">
                    <p className="text-base text-ink">
                      ¿Archivar la cuenta «{user.username}»? No se borra: la cuenta queda
                      archivada y pierde el acceso al panel.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        className="min-h-9 px-3 py-1 text-sm"
                        loading={pendingId === `archive-${user.id}`}
                        onClick={() => void handleArchive(user)}
                      >
                        Sí, archivar
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1 text-sm"
                        disabled={pendingId === `archive-${user.id}`}
                        onClick={closePanel}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Alta de una cuenta nueva, con roles y contraseña temporal. */
function CreateUserCard({
  roles,
  csrfToken,
  onCreated,
  onNotice,
  onError,
}: {
  roles: readonly RoleSummary[];
  csrfToken: string;
  onCreated: () => void;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;

    const cleanUsername = username.trim();
    if (
      cleanUsername.length < 3 ||
      cleanUsername.length > 64 ||
      !USERNAME_PATTERN.test(cleanUsername)
    ) {
      setUsernameError(
        'El usuario debe tener entre 3 y 64 caracteres y usar solo letras, números, punto, guion o guion bajo.',
      );
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }

    setUsernameError(null);
    setPasswordError(null);
    setCreating(true);
    onError(null);
    onNotice(null);
    try {
      await createUser(
        {
          username: cleanUsername,
          displayName: displayName.trim() || null,
          email: email.trim() || null,
          password,
          roles: selectedRoles,
        },
        csrfToken,
      );
      setUsername('');
      setDisplayName('');
      setEmail('');
      setPassword('');
      setSelectedRoles([]);
      onNotice(
        `Usuario «${cleanUsername}» creado. La persona deberá cambiar la contraseña en su primer ingreso.`,
      );
      onCreated();
    } catch (cause) {
      onError(
        cause instanceof ApiError && cause.status === 409
          ? 'Ese nombre de usuario ya está en uso.'
          : errorMessage(cause),
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-ink">Nuevo usuario</h2>
      <p className="text-base text-ink-muted">
        Crea una cuenta con una contraseña temporal. Al asignar roles, la cuenta
        recibe los permisos que esos roles conceden.
      </p>

      <form className="flex flex-col gap-4" noValidate onSubmit={handleCreate}>
        <TextField
          label="Usuario"
          required
          autoComplete="off"
          hint="Entre 3 y 64 caracteres: letras, números, punto, guion o guion bajo."
          error={usernameError ?? undefined}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            if (usernameError) setUsernameError(null);
          }}
        />
        <TextField
          label="Nombre para mostrar"
          autoComplete="off"
          hint="Opcional. Cómo se verá la persona en el panel."
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label="Correo"
          type="email"
          autoComplete="off"
          hint="Opcional."
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Contraseña temporal"
          type="password"
          required
          autoComplete="new-password"
          hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. La persona deberá cambiarla en su primer ingreso.`}
          error={passwordError ?? undefined}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (passwordError) setPasswordError(null);
          }}
        />
        <RoleChecklist
          roles={roles}
          selected={selectedRoles}
          disabled={creating}
          onToggle={(code) => setSelectedRoles((previous) => toggleRole(previous, code))}
        />
        <div>
          <Button type="submit" loading={creating}>
            Crear usuario
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Roles de la instalación en solo lectura, con los permisos que conceden. */
function RolesCard({ roles }: { roles: readonly RoleSummary[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-ink">Roles</h2>
      <p className="text-base text-ink-muted">
        Solo lectura. Al asignar un rol a una cuenta, esta recibe todos los
        permisos que el rol concede.
      </p>

      {roles.length === 0 ? (
        <StatusMessage>No hay roles configurados.</StatusMessage>
      ) : (
        <ul className="flex flex-col gap-4">
          {roles.map((role) => (
            <li key={role.code} className="flex flex-col gap-2 rounded-md border border-line px-3 py-3">
              <p className="text-base text-ink">
                <span className="font-bold">{role.name}</span>{' '}
                <span className="text-sm text-ink-muted">({role.code})</span>
              </p>
              {role.description ? (
                <p className="text-sm text-ink-muted">{role.description}</p>
              ) : null}
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-ink">Permisos que concede</p>
                {role.permissions.length === 0 ? (
                  <p className="text-sm text-ink-muted">Ninguno.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {role.permissions.map((permission) => (
                      <li
                        key={permission}
                        className="rounded-md border border-line bg-muted px-2 py-0.5 text-sm text-ink"
                      >
                        {permissionLabel(permission)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function UsersPage({ csrfToken }: { csrfToken: string }): JSX.Element {
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user: currentUser } = useSession();

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const state = useAsync<UsersPayload>((signal) => fetchUsers(signal), [reloadToken]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios"
        description="Cuentas que pueden ingresar al panel y los roles que definen qué pueden hacer."
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? (
        <Alert tone="error" title="No se pudo completar">
          {error}
        </Alert>
      ) : null}

      {state.status === 'loading' ? (
        <StatusMessage busy>Cargando los usuarios…</StatusMessage>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="error" title="No se pudieron cargar los usuarios">
            {errorMessage(state.error)}
          </Alert>
          <div>
            <Button variant="secondary" onClick={reload}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === 'ready' && state.data ? (
        <>
          <UsersCard
            users={state.data.users}
            roles={state.data.roles}
            csrfToken={csrfToken}
            selfUserId={currentUser?.id ?? null}
            onChanged={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <CreateUserCard
            roles={state.data.roles}
            csrfToken={csrfToken}
            onCreated={reload}
            onNotice={setNotice}
            onError={setError}
          />
          <RolesCard roles={state.data.roles} />
        </>
      ) : null}
    </div>
  );
}
