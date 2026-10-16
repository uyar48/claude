// NGSL 1.2 lexicon: lemma ranks, word forms → lemma, and the course word order.

import fs from 'node:fs';
import path from 'node:path';

export interface Lemma {
  lemma: string;
  rank: number;
  forms: string[];
}

const DIR = path.resolve('content/ngsl');

/**
 * Everyday A1 words that NGSL ranks late or leaves out (numbers, days, family,
 * food, colours, weather …). They are spread through Units 2–5 next to the
 * NGSL words, so a beginner can talk about ordinary life early.
 */
export const EVERYDAY: Record<number, string[]> = {
  2: ['two', 'three', 'eat', 'drink', 'sleep', 'bed', 'kitchen', 'sister', 'brother', 'son', 'daughter', 'wife', 'husband', 'today', 'tomorrow', 'yesterday', 'evening', 'happy', 'tired', 'hungry', 'dog', 'cat'],
  3: ['four', 'five', 'six', 'breakfast', 'lunch', 'dinner', 'milk', 'sugar', 'fruit', 'apple', 'cook', 'wash', 'clean', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'weekend', 'tonight'],
  4: ['seven', 'eight', 'nine', 'ten', 'hundred', 'red', 'blue', 'green', 'yellow', 'brown', 'sun', 'rain', 'cold', 'hot', 'warm', 'tree', 'flower', 'garden', 'park', 'bus', 'baby', 'sad'],
  5: ['teacher', 'doctor', 'hospital', 'bank', 'village', 'bird', 'fish', 'meat', 'chicken', 'rice', 'cake', 'email', 'message', 'bathroom', 'beautiful', 'expensive', 'weather', 'birthday', 'holiday', 'sea', 'river', 'mountain'],
};

/**
 * Forms of everyday words NGSL does not list (numbers, days …), and words
 * whose NGSL form means something else ("tired" is a form of "tire").
 */
export const EVERYDAY_FORMS: Record<string, string[]> = {
  two: ['two'],
  three: ['three'],
  four: ['four'],
  five: ['five'],
  six: ['six'],
  seven: ['seven'],
  eight: ['eight'],
  nine: ['nine'],
  ten: ['ten'],
  hundred: ['hundred', 'hundreds'],
  monday: ['monday', 'mondays'],
  tuesday: ['tuesday', 'tuesdays'],
  wednesday: ['wednesday', 'wednesdays'],
  thursday: ['thursday', 'thursdays'],
  friday: ['friday', 'fridays'],
  saturday: ['saturday', 'saturdays'],
  sunday: ['sunday', 'sundays'],
  hungry: ['hungry', 'hungrier', 'hungriest'],
  apple: ['apple', 'apples'],
  bathroom: ['bathroom', 'bathrooms'],
  birthday: ['birthday', 'birthdays'],
  tired: ['tired'],
};

/** Words shown with a capital letter. */
export const DISPLAY: Record<string, string> = {
  i: 'I',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/** NGSL lemmas plus the everyday supplement (rank -1 for words outside NGSL). */
export function loadNgsl(): Lemma[] {
  const ngsl = loadNgslOnly();
  const own = new Set(Object.values(EVERYDAY_FORMS).flat());
  const out = ngsl.map((l) => ({ ...l, forms: l.forms.filter((f) => !own.has(f) || EVERYDAY_FORMS[l.lemma]) }));
  for (const [lemma, forms] of Object.entries(EVERYDAY_FORMS)) {
    const i = out.findIndex((l) => l.lemma === lemma);
    if (i >= 0) out[i] = { ...out[i], forms };
    else out.push({ lemma, rank: -1, forms });
  }
  return out;
}

function loadNgslOnly(): Lemma[] {
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

/**
 * Full course order: started words, opening mix, then NGSL frequency order.
 * From Unit 2 on, each unit also takes its everyday words (EVERYDAY), spread
 * evenly between the NGSL words; a unit stays UNIT_SIZE words long.
 */
export function courseOrder(lemmas: Lemma[]): string[] {
  const everyday = new Set(Object.values(EVERYDAY).flat());
  const seen = new Set<string>();
  const base: string[] = [];
  const ranked = lemmas.filter((l) => l.rank >= 0).map((l) => l.lemma);
  for (const w of [...SABAH_STARTED, ...OPENING, ...ranked]) {
    if (seen.has(w)) continue;
    seen.add(w);
    base.push(w);
  }
  const out = base.slice(0, UNIT_SIZE); // Unit 1 is fixed
  const used = new Set(out);
  const rest = base.slice(UNIT_SIZE).filter((w) => !everyday.has(w));
  let r = 0;
  for (const unit of Object.keys(EVERYDAY).map(Number).sort((a, b) => a - b)) {
    const extra = EVERYDAY[unit].filter((w) => !used.has(w));
    const ngsl: string[] = [];
    while (ngsl.length < UNIT_SIZE - extra.length && r < rest.length) {
      const w = rest[r++];
      if (!used.has(w)) ngsl.push(w);
    }
    // Interleave by relative position: ngsl[i] at (i+0.5)/n, extra[j] at (j+0.5)/m.
    const merged = [
      ...ngsl.map((w, i) => ({ w, at: (i + 0.5) / ngsl.length })),
      ...extra.map((w, j) => ({ w, at: (j + 0.5) / extra.length })),
    ].sort((a, b) => a.at - b.at);
    for (const { w } of merged) {
      out.push(w);
      used.add(w);
    }
  }
  for (; r < rest.length; r++) if (!used.has(rest[r])) out.push(rest[r]);
  return out;
}
