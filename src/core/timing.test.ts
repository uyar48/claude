import { describe, expect, it } from 'vitest';
import { estimateTimings, timingsFromCharacters, timingsFromRecognized, wordAt } from './timing';

describe('word timings', () => {
  const text = 'The coffee is on the table.';

  it('estimates monotonic, non-overlapping timings within the clip', () => {
    const t = estimateTimings(text, 2.0);
    expect(t.map((x) => x.i)).toEqual([0, 1, 2, 3, 4, 5]);
    for (let k = 0; k < t.length; k++) {
      expect(t[k].end).toBeGreaterThan(t[k].start);
      if (k) expect(t[k].start).toBeGreaterThanOrEqual(t[k - 1].end);
    }
    expect(t[t.length - 1].end).toBeLessThanOrEqual(2.0);
    // longer word gets more time
    expect(t[1].end - t[1].start).toBeGreaterThan(t[2].end - t[2].start);
  });

  it('converts character alignment to word timings', () => {
    const s = 'I am home.';
    const starts = [...s].map((_, k) => k * 0.1);
    const ends = starts.map((x) => x + 0.1);
    expect(timingsFromCharacters(s, starts, ends)).toEqual([
      { i: 0, start: 0, end: 0.1 },
      { i: 1, start: 0.2, end: 0.4 },
      { i: 2, start: 0.5, end: 0.9 },
    ]);
  });

  it('aligns recognized words and interpolates misses', () => {
    const rec = [
      { word: 'The', start: 0.1, end: 0.2 },
      { word: 'coffee', start: 0.25, end: 0.6 },
      { word: "is'", start: 0.6, end: 0.7 },
      { word: 'on', start: 0.75, end: 0.85 },
      { word: 'table.', start: 1.0, end: 1.4 },
    ];
    const t = timingsFromRecognized(text, rec);
    expect(t).toHaveLength(6);
    expect(t[1]).toEqual({ i: 1, start: 0.25, end: 0.6 });
    expect(t[4].start).toBeCloseTo(0.85); // "the" missing → between "on" and "table"
    expect(t[5]).toEqual({ i: 5, start: 1.0, end: 1.4 });
  });

  it('finds the word at a given time', () => {
    const t = [
      { i: 0, start: 0, end: 0.5 },
      { i: 1, start: 0.6, end: 1 },
    ];
    expect(wordAt(t, 0.2)).toBe(0);
    expect(wordAt(t, 0.55)).toBe(0);
    expect(wordAt(t, 0.7)).toBe(1);
    expect(wordAt(t, 3)).toBeNull();
  });
});
