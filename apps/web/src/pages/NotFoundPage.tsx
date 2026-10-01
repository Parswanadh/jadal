import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="page-title">{t('common.notFoundTitle')}</h1>
      <p className="page-lead">{t('common.notFoundBody')}</p>
      <p>
        <Link to="/">{t('common.backHome')}</Link>
      </p>
    </div>
  );
}
