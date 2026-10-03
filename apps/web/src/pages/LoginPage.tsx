import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/RequireRole';
import type { Role } from '../auth/session';
import { useI18n } from '../i18n/I18nContext';

const ROLES: Role[] = ['farmer', 'coordinator'];

/** Sign-in screen. Public: it is where the role guard sends an unauthenticated visitor. */
export default function LoginPage() {
  const { t } = useI18n();
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [role, setRole] = useState<Role>('farmer');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);

  // Where the visitor was headed, when the guard sent them here.
  const from = (location.state as { from?: string } | null)?.from ?? null;
  const landing = (forRole: Role): string =>
    from?.startsWith(`/${forRole}`) ? from : ROLE_HOME[forRole];

  // Already signed in: never show the form again. This also completes the
  // sign-in below, so the intended screen (with its query) is not lost.
  if (session) return <Navigate to={landing(session.role)} replace />;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!signIn(role, password)) {
      // Deliberately vague: do not reveal which of the two inputs was wrong.
      setFailed(true);
      return;
    }
    setFailed(false);
  }

  return (
    <section className="login" aria-labelledby="login-title">
      <p className="eyebrow">{t('login.eyebrow')}</p>
      <h1 className="page-title" id="login-title">
        {t('login.title')}
      </h1>
      <p className="page-lead">{t('login.lead')}</p>

      <form className="card login-card" onSubmit={submit}>
        <div className="field">
          <span className="field-label" id="login-role-label">
            {t('login.roleLabel')}
          </span>
          <div className="segmented" role="group" aria-labelledby="login-role-label">
            {ROLES.map((option) => (
              <button
                key={option}
                type="button"
                className="segment"
                aria-pressed={role === option}
                onClick={() => {
                  setRole(option);
                  setFailed(false);
                }}
              >
                {t(`login.role.${option}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="login-password">{t('login.passwordLabel')}</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setFailed(false);
            }}
          />
        </div>

        {failed && (
          <div className="notice notice-crit" role="alert">
            <p>{t('login.error')}</p>
          </div>
        )}

        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={password.length === 0}>
            {t('login.submit')}
          </button>
        </div>
      </form>

      {/* Quiet note: there is no self sign-up, and the passwords are not public. */}
      <aside className="login-note" aria-labelledby="login-note-title">
        <p className="field-label" id="login-note-title">
          {t('login.noteTitle')}
        </p>
        <p className="muted small">{t('login.rolesHint')}</p>
        <p className="muted small">{t('login.noteBody')}</p>
      </aside>
    </section>
  );
}
