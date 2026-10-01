import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import PageHeader from '../components/PageHeader';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader eyebrow="404" title={t('common.notFoundTitle')} lead={t('common.notFoundBody')} />
      <p>
        <Link to="/">{t('common.backHome')}</Link>
      </p>
    </div>
  );
}
