import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('farmer');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);

  // Already signed in: never show the form again.
  if (session) return <Navigate to={ROLE_HOME[session.role]} replace />;

  const from = (location.state as { from?: string } | null)?.from;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!signIn(role, password)) {
      // Deliberately vague: do not reveal which of the two inputs was wrong.
      setFailed(true);
      return;
    }
    setFailed(false);
    const intended = from && from.startsWith(`/${role}`) ? from : ROLE_HOME[role];
    navigate(intended, { replace: true });
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
    </section>
  );
}
