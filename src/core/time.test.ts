import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, endOfLocalDay, formatHm, localParts, parseHm } from './time';

describe('time helpers', () => {
  it('converts instants to Istanbul wall clock', () => {
    expect(localParts(Date.UTC(2026, 9, 14, 21, 30), 'Europe/Istanbul')).toEqual({ date: '2026-10-15', minutes: 30 });
    expect(localParts(Date.UTC(2026, 9, 14, 20, 59), 'Europe/Istanbul')).toEqual({ date: '2026-10-14', minutes: 23 * 60 + 59 });
  });

  it('end of local day is next local midnight', () => {
    expect(endOfLocalDay(Date.UTC(2026, 9, 14, 9, 0), 'Europe/Istanbul')).toBe(Date.UTC(2026, 9, 14, 21, 0));
    // DST zone: Berlin on the October change (25h day)
    expect(endOfLocalDay(Date.UTC(2026, 9, 25, 10, 0), 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 25, 23, 0));
  });

  it('parses and formats HH:MM', () => {
    expect(parseHm('08:05')).toBe(485);
    expect(formatHm(485)).toBe('08:05');
    expect(() => parseHm('25:00')).toThrow();
  });

  it('date arithmetic', () => {
    expect(daysBetween('2026-10-14', '2026-10-21')).toBe(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
