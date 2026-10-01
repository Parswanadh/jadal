import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

interface PlaceholderProps {
  titleKey: string;
  bodyKey: string;
  noteKey: string;
}

export default function PlaceholderPage({ titleKey, bodyKey, noteKey }: PlaceholderProps) {
  const { t } = useI18n();
  return (
    <div>
      <p>
        <span className="badge">{t('common.comingSoon')}</span>
      </p>
      <h1 className="page-title">{t(titleKey)}</h1>
      <p className="page-lead">{t(bodyKey)}</p>
      <div className="panel">
        <p>{t('common.placeholderDetail')}</p>
      </div>
      <p className="api-note">{t(noteKey)}</p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link to="/">{t('common.backHome')}</Link>
      </p>
    </div>
  );
}
