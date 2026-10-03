import { isMockMode } from '../api';
import { useI18n } from '../i18n/I18nContext';

/**
 * The one "Demo data" pill used on every screen.
 * It shows only while the app runs on sample data. Once the live server is
 * connected it renders nothing.
 */
export default function DataBadge() {
  const { t } = useI18n();
  if (!isMockMode()) return null;
  const tip = t('common.demoBadgeTip');
  return (
    <span className="chip chip-warn data-badge" title={tip} tabIndex={0} role="note" aria-label={`${t('common.demoBadge')}. ${tip}`}>
      {t('common.demoBadge')}
    </span>
  );
}
