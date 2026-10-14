// Time-zone helpers built on Intl so they behave the same in browsers, Node and
// serverless functions. All instants are epoch milliseconds.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const DEFAULT_TZ = 'Europe/Istanbul';

export interface LocalParts {
  /** YYYY-MM-DD in the given zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(at: number, tz: string = DEFAULT_TZ): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
  };
}

export function localDate(at: number, tz: string = DEFAULT_TZ): string {
  return localParts(at, tz).date;
}

/** "HH:MM" → minutes since midnight. */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) throw new Error(`Invalid time: ${hm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time: ${hm}`);
  return h * 60 + min;
}

export function formatHm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/**
 * Epoch ms of the end of the local day containing `at` (exclusive upper bound,
 * i.e. next local midnight). Works for any fixed or DST zone by probing offsets.
 */
export function endOfLocalDay(at: number, tz: string = DEFAULT_TZ): number {
  const { date: today, minutes } = localParts(at, tz);
  let end = Math.floor(at / MINUTE) * MINUTE + (1440 - minutes) * MINUTE;
  // DST days are 23h or 25h long; nudge in 15-minute steps (zones shift by ≥15 min).
  while (localDate(end, tz) === today) end += 15 * MINUTE;
  while (localDate(end - 15 * MINUTE, tz) !== today) end -= 15 * MINUTE;
  return end;
}
