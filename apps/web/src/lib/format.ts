/**
 * Display formatting for dates, times and numbers.
 *
 * Everything here only changes how a value looks. It never computes water
 * numbers. Dates are shown in the canal's own time zone (India) so a farmer,
 * a coordinator and a judge all read the same clock.
 */

export type Lang = 'en' | 'te';

const TZ = 'Asia/Kolkata';

const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TE_DAYS = ['ఆది', 'సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని'];
const TE_MONTHS = ['జన', 'ఫిబ్ర', 'మార్చి', 'ఏప్రి', 'మే', 'జూన్', 'జూలై', 'ఆగ', 'సెప్టెం', 'అక్టో', 'నవం', 'డిసెం'];

interface Clock {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number; // 0-23
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
});

function clockOf(date: Date): Clock {
  const all = partsFormatter.formatToParts(date);
  const get = (type: string): string => all.find((p) => p.type === type)?.value ?? '0';
  const weekday = EN_DAYS.indexOf(get('weekday'));
  return {
    year: Number(get('year')),
    month: Number(get('month')) - 1,
    day: Number(get('day')),
    weekday: weekday < 0 ? 0 : weekday,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Part of the day in Telugu. */
function teDayPeriod(hour: number): string {
  if (hour >= 4 && hour < 12) return 'ఉదయం';
  if (hour >= 12 && hour < 16) return 'మధ్యాహ్నం';
  if (hour >= 16 && hour < 20) return 'సాయంత్రం';
  return 'రాత్రి';
}

function hour12(hour: number): number {
  const h = hour % 12;
  return h === 0 ? 12 : h;
}

function mm(minute: number): string {
  return String(minute).padStart(2, '0');
}

/** "6:00" without the am/pm marker. */
function clockText(c: Clock): string {
  return `${String(hour12(c.hour))}:${mm(c.minute)}`;
}

function meridiem(c: Clock, lang: Lang): string {
  return lang === 'te' ? teDayPeriod(c.hour) : c.hour < 12 ? 'am' : 'pm';
}

/** "6:00 am" in English, "ఉదయం 6:00" in Telugu. */
function timeWithMarker(c: Clock, lang: Lang): string {
  return lang === 'te' ? `${meridiem(c, lang)} ${clockText(c)}` : `${clockText(c)} ${meridiem(c, lang)}`;
}

function dayText(c: Clock, lang: Lang): string {
  return lang === 'te'
    ? `${TE_DAYS[c.weekday] ?? ''} ${String(c.day)} ${TE_MONTHS[c.month] ?? ''}`
    : `${EN_DAYS[c.weekday] ?? ''} ${String(c.day)} ${EN_MONTHS[c.month] ?? ''}`;
}

/** "Mon 14 Sep" */
export function formatDay(iso: string, lang: Lang): string {
  const d = parse(iso);
  return d ? dayText(clockOf(d), lang) : iso;
}

/** "Mon 14 Sep, 6:00 am" */
export function formatDateTime(iso: string, lang: Lang): string {
  const d = parse(iso);
  if (!d) return iso;
  const c = clockOf(d);
  return `${dayText(c, lang)}, ${timeWithMarker(c, lang)}`;
}

/** "6:00 am" */
export function formatTimeOfDay(iso: string, lang: Lang): string {
  const d = parse(iso);
  return d ? timeWithMarker(clockOf(d), lang) : iso;
}

/**
 * "Tue 15 Sep, 6:00–9:00 am" for a turn inside one day, or both ends in full
 * when it crosses midnight.
 */
export function formatRange(startIso: string, endIso: string, lang: Lang): string {
  const s = parse(startIso);
  const e = parse(endIso);
  if (!s || !e) return `${startIso} – ${endIso}`;
  const a = clockOf(s);
  const b = clockOf(e);
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  if (!sameDay) return `${formatDateTime(startIso, lang)} – ${formatDateTime(endIso, lang)}`;
  if (meridiem(a, lang) === meridiem(b, lang)) {
    return lang === 'te'
      ? `${dayText(a, lang)}, ${meridiem(a, lang)} ${clockText(a)}–${clockText(b)}`
      : `${dayText(a, lang)}, ${clockText(a)}–${clockText(b)} ${meridiem(b, lang)}`;
  }
  return `${dayText(a, lang)}, ${timeWithMarker(a, lang)} – ${timeWithMarker(b, lang)}`;
}

/** A plain date such as "2026-07-10" shown as "Fri 10 Jul". */
export function formatDateOnly(isoDate: string, lang: Lang): string {
  return formatDay(`${isoDate}T12:00:00+05:30`, lang);
}

/** Whole numbers with Indian digit grouping: 24,000 and 1,50,000. */
export function formatNumber(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: maxFractionDigits });
}

/** Join names as "A, B and C" in the active language. */
export function formatList(items: string[], lang: Lang): string {
  try {
    return new Intl.ListFormat(lang, { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

export interface HoursText {
  hours: number;
  minutes: number;
}

/** Split a length in hours into whole hours and minutes, for display. */
export function splitHours(totalHours: number): HoursText {
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);
  return minutes === 60 ? { hours: hours + 1, minutes: 0 } : { hours, minutes };
}

/**
 * Clock length of a span, for display only: how many hours lie between two
 * timestamps. Returns null when either end is unreadable, so callers omit the
 * hint rather than print a raw timestamp.
 */
export function hoursBetween(startIso: string, endIso: string): number | null {
  const s = parse(startIso);
  const e = parse(endIso);
  if (!s || !e) return null;
  return (e.getTime() - s.getTime()) / 3_600_000;
}
