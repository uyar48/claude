// Splits English text into display tokens. Word tokens carry a normalized form
// used for lookups; punctuation/space tokens are kept so text can be re-rendered.

export interface Token {
  text: string;
  /** Lower-cased word form, or null for punctuation/whitespace. */
  norm: string | null;
  /** Running index among word tokens of the same string (null for non-words). */
  wordIndex: number | null;
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let wordIndex = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) tokens.push({ text: text.slice(last, start), norm: null, wordIndex: null });
    tokens.push({ text: m[0], norm: normalize(m[0]), wordIndex: wordIndex++ });
    last = start + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), norm: null, wordIndex: null });
  return tokens;
}

export function normalize(word: string): string {
  return word.toLowerCase().replace(/’/g, "'");
}

export function words(text: string): string[] {
  return tokenize(text)
    .filter((t) => t.norm !== null)
    .map((t) => t.norm as string);
}
