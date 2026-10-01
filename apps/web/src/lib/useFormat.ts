import { useMemo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  formatDateOnly,
  formatDateTime,
  formatDay,
  formatList,
  formatNumber,
  formatRange,
  formatTimeOfDay,
  splitHours,
} from './format';

/** Formatting helpers bound to the active language. Display only. */
export function useFormat() {
  const { lang, t } = useI18n();
  return useMemo(
    () => ({
      lang,
      num: (n: number, digits = 0) => formatNumber(n, digits),
      /** "1,566 m³" */
      m3: (n: number) => `${formatNumber(n)} ${t('units.m3')}`,
      pct: (n: number) => `${formatNumber(n)}%`,
      dateTime: (iso: string) => formatDateTime(iso, lang),
      day: (iso: string) => formatDay(iso, lang),
      time: (iso: string) => formatTimeOfDay(iso, lang),
      range: (start: string, end: string) => formatRange(start, end, lang),
      dateOnly: (isoDate: string) => formatDateOnly(isoDate, lang),
      list: (items: string[]) => formatList(items, lang),
      /** "3 h" or "3 h 30 min" */
      length: (totalHours: number) => {
        const { hours, minutes } = splitHours(totalHours);
        return minutes === 0
          ? t('units.hoursOnly', { h: hours })
          : t('units.hoursMinutes', { h: hours, m: minutes });
      },
      /** "Outlet 7" (or the Telugu form) from the API outlet name. */
      outlet: (name: string) => {
        const match = /^Outlet\s+(\d+)$/i.exec(name.trim());
        return match?.[1] ? t('units.outlet', { n: match[1] }) : name;
      },
      crop: (crop: string) => t(`crop.${crop}`),
      soil: (soil: string) => t(`soil.${soil}`),
      channel: (channel: string) => t(`channel.${channel}`),
    }),
    [lang, t],
  );
}

export type Formatter = ReturnType<typeof useFormat>;
