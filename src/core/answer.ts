// Tolerant checking of typed answers: single words (dictation, typed gaps)
// and whole sentences (sentence dictation, Turkish → English writing).
//
// Never matters: case, punctuation, extra spaces, curly quotes, contractions
// ("I'm" = "I am"). One typo is fine from 4 letters on, two from 8 letters.
// When writing from Turkish, he/she/it (and his/her/its, him/her) count as
// the same word, because Turkish "o" does not say which one is meant.

/** Lower-case letters only ("I'm" → "im"). */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z]/g, '');
}

export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Typos allowed in a word of this length. */
const typos = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** One word: case, spaces and punctuation never matter; small typos are "close". */
export function dictationVerdict(input: string, answer: string): 'right' | 'close' | 'wrong' {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(answer);
  if (!a) return 'wrong';
  if (a === b) return 'right';
  if (editDistance(a, b) <= typos(b.length)) return 'close';
  return 'wrong';
}

const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am',
  "you're": 'you are',
  "we're": 'we are',
  "they're": 'they are',
  "he's": 'he is',
  "she's": 'she is',
  "it's": 'it is',
  "that's": 'that is',
  "there's": 'there is',
  "here's": 'here is',
  "what's": 'what is',
  "who's": 'who is',
  "where's": 'where is',
  "how's": 'how is',
  "i've": 'i have',
  "you've": 'you have',
  "we've": 'we have',
  "they've": 'they have',
  "i'll": 'i will',
  "you'll": 'you will',
  "he'll": 'he will',
  "she'll": 'she will',
  "it'll": 'it will',
  "we'll": 'we will',
  "they'll": 'they will',
  "i'd": 'i would',
  "you'd": 'you would',
  "he'd": 'he would',
  "she'd": 'she would',
  "we'd": 'we would',
  "they'd": 'they would',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "hadn't": 'had not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "can't": 'can not',
  cannot: 'can not',
  "couldn't": 'could not',
  "shouldn't": 'should not',
  "mustn't": 'must not',
  "let's": 'let us',
};

/** Words that count as the same when writing from Turkish. */
const SAME_FROM_TURKISH = [
  ['he', 'she', 'it'],
  ['his', 'her', 'its'],
  ['him', 'her', 'it'],
];

/** Comparable words of one written word ("Don't," → ["do", "not"]). */
function expand(word: string): string[] {
  const w = word.toLowerCase().replace(/’/g, "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
  if (!w) return [];
  const full = CONTRACTIONS[w];
  return (full ?? w).split(' ').map((x) => x.replace(/'/g, ''));
}

interface Tok {
  w: string;
  /** Index of the written word it came from. */
  src: number;
}

function tokens(text: string): { words: string[]; toks: Tok[] } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const toks = words.flatMap((word, src) => expand(word).map((w) => ({ w, src })));
  return { words, toks };
}

export type WordMark = 'ok' | 'typo' | 'miss';

export interface SentenceCheck {
  verdict: 'right' | 'close' | 'wrong';
  /** The reference sentence word by word, each marked. */
  marks: Array<{ word: string; mark: WordMark }>;
  /** Written words that match nothing in the reference. */
  extra: string[];
}

/**
 * Compares a typed sentence with the reference, word by word (an edit
 * distance over words, where a small typo is a free "close" match).
 */
export function checkSentence(input: string, reference: string, opts: { fromTurkish?: boolean } = {}): SentenceCheck {
  const ref = tokens(reference);
  const got = tokens(input);
  const a = got.toks;
  const b = ref.toks;
  const same = (x: string, y: string) =>
    x === y || (opts.fromTurkish === true && SAME_FROM_TURKISH.some((g) => g.includes(x) && g.includes(y)));
  const pair = (x: string, y: string): 0 | 1 | 2 => (same(x, y) ? 0 : editDistance(x, y) <= typos(y.length) ? 1 : 2);

  // cost[i][j]: aligning a[0..i) with b[0..j). Typos cost a tiny bit so exact matches win.
  const TYPO = 0.01;
  const cost = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) cost[i][0] = i;
  for (let j = 1; j <= b.length; j++) cost[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const p = pair(a[i - 1].w, b[j - 1].w);
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (p === 0 ? 0 : p === 1 ? TYPO : 1));
    }
  }

  // Walk back to mark each reference token.
  const tokMark: WordMark[] = b.map(() => 'miss');
  const extra: string[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const p = pair(a[i - 1].w, b[j - 1].w);
      const step = p === 0 ? 0 : p === 1 ? TYPO : 1;
      if (Math.abs(cost[i][j] - (cost[i - 1][j - 1] + step)) < 1e-9) {
        tokMark[j - 1] = p === 0 ? 'ok' : p === 1 ? 'typo' : 'miss';
        if (p === 2) extra.push(a[i - 1].w);
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && Math.abs(cost[i][j] - (cost[i][j - 1] + 1)) < 1e-9) {
      tokMark[j - 1] = 'miss';
      j--;
    } else {
      extra.push(a[i - 1].w);
      i--;
    }
  }
  extra.reverse();

  // A written word is as good as its worst part ("don't" = "do" + "not").
  const rank: Record<WordMark, number> = { ok: 0, typo: 1, miss: 2 };
  const marks = ref.words.map((word, src) => {
    let mark: WordMark = 'ok';
    b.forEach((t, k) => {
      if (t.src === src && rank[tokMark[k]] > rank[mark]) mark = tokMark[k];
    });
    return { word, mark };
  });
  const worst = Math.max(0, ...tokMark.map((m) => rank[m]));
  const verdict = a.length === 0 ? 'wrong' : extra.length > 0 || worst === 2 ? 'wrong' : worst === 1 ? 'close' : 'right';
  return { verdict, marks, extra };
}

/** The reference shown without marks (the learner asked to see it). */
export function revealSentence(reference: string): SentenceCheck {
  const words = reference.trim().split(/\s+/).filter(Boolean);
  return { verdict: 'wrong', marks: words.map((word) => ({ word, mark: 'ok' })), extra: [] };
}

/** Number of words a learner types for this sentence (contractions count once). */
export function wordsToType(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
}
