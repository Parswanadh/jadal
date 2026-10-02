import { useI18n } from '../i18n/I18nContext';

/** A short helper for the first place a screen shows m³. */
export default function UnitHint() {
  const { t } = useI18n();
  return <p className="unit-hint">{t('common.m3Help')}</p>;
}
