import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import DataBadge from '../components/DataBadge';

const FLOW_STEPS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'] as const;

export default function HomePage() {
  const { t } = useI18n();

  const cards = [
    { to: '/farmer', title: t('home.farmerCardTitle'), body: t('home.farmerCardBody') },
    { to: '/coordinator', title: t('home.coordinatorCardTitle'), body: t('home.coordinatorCardBody') },
    { to: '/canal', title: t('home.canalCardTitle'), body: t('home.canalCardBody') },
    { to: '/phone', title: t('home.phoneCardTitle'), body: t('home.phoneCardBody') },
    { to: '/demo', title: t('home.demoCardTitle'), body: t('home.demoCardBody') },
  ];

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">{t('home.eyebrow')}</p>
        <h1>{t('home.title')}</h1>
        <p>{t('home.subtitle')}</p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" to="/demo">
            {t('home.ctaDemo')}
          </Link>
          <Link className="btn btn-lg" to="/farmer">
            {t('home.ctaFarmer')}
          </Link>
          <DataBadge />
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-flow">
        <h2 className="section-label" id="home-flow">
          {t('home.flowTitle')}
        </h2>
        <ol className="flow">
          {FLOW_STEPS.map((key, i) => (
            <li key={key} className="flow-step">
              <span className="flow-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>{t(`home.${key}`)}</span>
            </li>
          ))}
        </ol>
        <div className="loop" aria-hidden="true">
          <span>{t('home.loopLabel')}</span>
        </div>
        <p className="loop-note">{t('home.loopLabel')}</p>
      </section>

      <section className="home-section" aria-labelledby="home-screens">
        <h2 className="section-label" id="home-screens">
          {t('home.portalsTitle')}
        </h2>
        <div className="screens">
          {cards.map((card) => (
            <Link key={card.to} className="screen-card" to={card.to}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <span className="screen-card-open">{t('home.openLabel')} →</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="principle">{t('home.principle')}</p>
    </div>
  );
}
