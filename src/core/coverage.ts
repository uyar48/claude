// Lexical coverage: share of running words (tokens) in a text that the learner
// already knows. Texts below the threshold are not offered.
//
// "Known" = the unit's function words + every word whose card has left the
// `new` state (introduced in a lesson or tapped while reading). Graduation to
// `known` in the SRS is NOT required, otherwise no text would be readable in
// the first week.

import { words } from './tokenize.js';

export const COVERAGE_THRESHOLD = 0.95;

export interface CoverageResult {
  /** 0..1 */
  ratio: number;
  total: number;
  known: number;
  unknownWords: string[];
}

export function coverage(text: string | string[], known: ReadonlySet<string>): CoverageResult {
  const all = (Array.isArray(text) ? text : [text]).flatMap((t) => words(t));
  let k = 0;
  const unknown = new Set<string>();
  for (const w of all) {
    if (known.has(w)) k++;
    else unknown.add(w);
  }
  return {
    ratio: all.length === 0 ? 1 : k / all.length,
    total: all.length,
    known: k,
    unknownWords: [...unknown],
  };
}

export function isReadable(text: string | string[], known: ReadonlySet<string>, threshold = COVERAGE_THRESHOLD) {
  return coverage(text, known).ratio >= threshold;
}
