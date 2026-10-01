import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { fetchHealth } from '../lib/api';

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; version: string; operational: boolean }
  | { status: 'error'; message: string };

export default function HomePage() {
  const { t } = useI18n();
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((data) => setHealth({ status: 'ok', version: data.version, operational: data.ok }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHealth({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  const cards = [
    { to: '/farmer', title: t('home.farmerCardTitle'), body: t('home.farmerCardBody') },
    { to: '/coordinator', title: t('home.coordinatorCardTitle'), body: t('home.coordinatorCardBody') },
    { to: '/canal', title: t('home.canalCardTitle'), body: t('home.canalCardBody') },
    { to: '/phone', title: t('home.phoneCardTitle'), body: t('home.phoneCardBody') },
    { to: '/demo', title: t('home.demoCardTitle'), body: t('home.demoCardBody') },
  ];

  return (
    <div>
      <h1 className="page-title">{t('home.title')}</h1>
      <p className="page-lead">{t('home.subtitle')}</p>

      <section className="panel" aria-live="polite" aria-label={t('home.healthTitle')}>
        <h2>{t('home.healthTitle')}</h2>
        {health.status === 'loading' && <p>{t('home.healthChecking')}</p>}
        {health.status === 'ok' && (
          <p>
            <span className={health.operational ? 'status-ok' : 'status-bad'}>
              {health.operational ? t('home.healthOperational') : t('home.healthDegraded')}
            </span>{' '}
            · {t('home.versionLabel')}: {health.version}
          </p>
        )}
        {health.status === 'error' && (
          <p>
            <span className="status-bad">{t('home.healthUnreachable')}</span> ({health.message})
          </p>
        )}
      </section>

      <h2 style={{ marginTop: '2rem' }}>{t('home.portalsTitle')}</h2>
      <div className="card-grid">
        {cards.map((card) => (
          <article key={card.to} className="card">
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <Link className="card-link" to={card.to}>
              {card.title} →
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
