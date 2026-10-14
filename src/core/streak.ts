import { addDays } from './time.js';

/**
 * Consecutive local days with at least one completed lesson. The streak stays
 * alive until the end of today, so an unfinished "today" does not reset it.
 */
export function streak(completedDates: Iterable<string>, today: string): number {
  const days = new Set(completedDates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}
