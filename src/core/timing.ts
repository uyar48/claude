// Word timings for read-aloud highlighting. Three sources, best first:
//   1. provider timestamps (e.g. ElevenLabs character alignment)
//   2. forced alignment (speech-to-text word timestamps matched to our words)
//   3. estimate: duration split by word length, with pauses after punctuation

import type { WordTiming } from '../content/types.js';
import { tokenize } from './tokenize.js';

/** Character-level alignment → word timings (token indexes as in tokenize()). */
export function timingsFromCharacters(text: string, charStarts: number[], charEnds: number[]): WordTiming[] {
  const out: WordTiming[] = [];
  let pos = 0;
  for (const t of tokenize(text)) {
    const start = pos;
    pos += t.text.length;
    if (t.wordIndex === null) continue;
    const s = charStarts[start];
    const e = charEnds[Math.min(pos - 1, charEnds.length - 1)];
    if (s === undefined || e === undefined) continue;
    out.push({ i: t.wordIndex, start: round(s), end: round(e) });
  }
  return out;
}

/**
 * Matches recognized words (speech-to-text output) to the sentence's words in
 * order. Unmatched words get interpolated times.
 */
export function timingsFromRecognized(
  text: string,
  recognized: Array<{ word: string; start: number; end: number }>,
): WordTiming[] {
  const ours = tokenize(text).filter((t) => t.norm !== null);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');
  const result: Array<WordTiming | null> = ours.map(() => null);
  let j = 0;
  ours.forEach((t, k) => {
    for (let look = j; look < Math.min(recognized.length, j + 3); look++) {
      if (norm(recognized[look].word) === t.norm) {
        result[k] = { i: t.wordIndex!, start: round(recognized[look].start), end: round(recognized[look].end) };
        j = look + 1;
        return;
      }
    }
  });
  // Interpolate gaps between known neighbours.
  for (let k = 0; k < result.length; k++) {
    if (result[k]) continue;
    const prev = result.slice(0, k).reverse().find(Boolean);
    const next = result.slice(k + 1).find(Boolean);
    const start = prev ? prev.end : 0;
    const end = next ? next.start : start + 0.4;
    result[k] = { i: ours[k].wordIndex!, start: round(start), end: round(Math.max(end, start + 0.05)) };
  }
  return result as WordTiming[];
}

/** Even-ish split of the clip: longer words get more time, punctuation adds a pause. */
export function estimateTimings(text: string, duration: number, leadIn = 0.05): WordTiming[] {
  const tokens = tokenize(text);
  const weights: Array<{ i: number; w: number; pause: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.wordIndex === null) continue;
    const after = tokens[k + 1]?.text ?? '';
    const pause = /[.!?]/.test(after) ? 2.5 : /[,;:]/.test(after) ? 1.2 : 0;
    weights.push({ i: t.wordIndex, w: 2 + t.text.length, pause });
  }
  const total = weights.reduce((a, b) => a + b.w + b.pause, 0) || 1;
  const usable = Math.max(0, duration - leadIn);
  let cursor = leadIn;
  return weights.map(({ i, w, pause }) => {
    const start = cursor;
    const end = start + (w / total) * usable;
    cursor = end + (pause / total) * usable;
    return { i, start: round(start), end: round(end) };
  });
}

/** Index of the word being spoken at time t (seconds), or null. */
export function wordAt(timings: WordTiming[], t: number): number | null {
  for (const w of timings) if (t >= w.start && t < w.end) return w.i;
  // between words: keep the previous one lit for a smoother look
  let last: number | null = null;
  for (const w of timings) if (t >= w.end) last = w.i;
  return t < (timings[timings.length - 1]?.end ?? 0) + 0.15 ? last : null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
