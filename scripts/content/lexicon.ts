// NGSL 1.2 lexicon: lemma ranks, word forms → lemma, and the course word order.

import fs from 'node:fs';
import path from 'node:path';

export interface Lemma {
  lemma: string;
  rank: number;
  forms: string[];
}

const DIR = path.resolve('content/ngsl');

export function loadNgsl(): Lemma[] {
  const stats = fs.readFileSync(path.join(DIR, 'NGSL_1.2_stats.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const rank = new Map<string, number>();
  for (const line of stats) {
    const [lemma, r] = line.split(',');
    rank.set(lemma.trim().toLowerCase(), Number(r));
  }
  const forms = new Map<string, string[]>();
  for (const line of fs.readFileSync(path.join(DIR, 'NGSL_1.2_lemmatized_for_teaching.csv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (parts.length) forms.set(parts[0], parts);
  }
  return [...rank.entries()]
    .map(([lemma, r]) => ({ lemma, rank: r, forms: forms.get(lemma) ?? [lemma] }))
    .sort((a, b) => a.rank - b.rank);
}

/** Form → lemma. On collisions the more frequent lemma wins ("s" → be). */
export function formIndex(lemmas: Lemma[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const l of lemmas) {
    for (const f of l.forms) if (!idx.has(f)) idx.set(f, l.lemma);
  }
  return idx;
}

/**
 * Word tokens for lexical analysis: lower-cased letters only, contractions
 * split at the apostrophe ("I'm" → i, m; "don't" → don, t). Capitalisation is
 * kept separately so proper names can be recognised.
 */
export function lexTokens(text: string): Array<{ form: string; capital: boolean; initial: boolean }> {
  const out: Array<{ form: string; capital: boolean; initial: boolean }> = [];
  let first = true;
  let last = 0;
  for (const m of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    // A word right after . ? ! starts a new sentence.
    if (/[.?!]/.test(text.slice(last, m.index))) first = true;
    last = (m.index ?? 0) + m[0].length;
    const parts = m[0].split(/['’]/);
    parts.forEach((p, i) => {
      out.push({ form: p.toLowerCase(), capital: /^[A-Z]/.test(p), initial: first && i === 0 });
    });
    first = false;
  }
  return out;
}

export type TokenLemma = string | { name: string } | null;

/** Maps each token to a lemma, a proper name, or null (unknown word). */
export function lemmatize(text: string, idx: Map<string, string>): TokenLemma[] {
  return lexTokens(text).map((t) => {
    if (t.capital && NAMES.has(t.form)) return { name: t.form };
    const lemma = idx.get(t.form);
    if (lemma && !(t.capital && !t.initial && !COMMON_CAPITALISED.has(t.form))) return lemma;
    return null; // unknown word, nationality, place name …
  });
}

/** First names that may appear in sentences without being vocabulary. */
export const NAMES = new Set(
  'tom mary john alice bob ken jack mike jim dan sami layla ziri yanni emily lucy anna maria paul peter david james linda sarah jane bill tony sam ann nancy kate betty judy meg ben fred george henry jill lisa mark tim'.split(' '),
);

/** Words that are written with a capital but are ordinary vocabulary. */
const COMMON_CAPITALISED = new Set(['i', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'english']);

// ---------- course order ----------

/** Words the learner had already started with (Sabah unit), kept first. */
export const SABAH_STARTED = ['house', 'door', 'window', 'table', 'water', 'woman', 'man', 'tea', 'egg', 'bread'];
/** Then the remaining Sabah nouns interleaved with the most basic function words. */
export const OPENING = [
  'the', 'be', 'a', 'i', 'have', 'key', 'bag', 'car', 'street', 'chair',
  'and', 'in', 'on', 'at', 'to', 'go', 'good', 'morning', 'home', 'coffee',
  'phone', 'work',
];
/**
 * Function words the learner has met (with glosses) since the first lesson;
 * they count as known for sentence coverage while being taught properly.
 */
export const STARTER_KNOWN = ['i', 'be', 'a', 'the', 'in', 'on', 'at', 'to', 'and', 'have', 'go', 'good'];

export const UNIT_SIZE = 100;

/** Full course order: started words, opening mix, then NGSL frequency order. */
export function courseOrder(lemmas: Lemma[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...SABAH_STARTED, ...OPENING, ...lemmas.map((l) => l.lemma)]) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}
