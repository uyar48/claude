import { describe, expect, it } from 'vitest';
import { checkSentence, dictationVerdict, revealSentence, wordsToType } from './answer';

describe('typed word', () => {
  it('ignores case and punctuation, allows small typos', () => {
    expect(dictationVerdict(' House. ', 'house')).toBe('right');
    expect(dictationVerdict('hous', 'house')).toBe('close');
    expect(dictationVerdict('hause', 'house')).toBe('close');
    expect(dictationVerdict('hoose', 'mouse')).toBe('wrong');
    // Short words must be exact: "in" is not "on".
    expect(dictationVerdict('in', 'on')).toBe('wrong');
    // Long words allow two typos.
    expect(dictationVerdict('tommorow', 'tomorrow')).toBe('close');
    expect(dictationVerdict('', 'house')).toBe('wrong');
  });
});

describe('typed sentence', () => {
  it('accepts the same sentence written differently', () => {
    expect(checkSentence("i'm at home", "I'm at home.").verdict).toBe('right');
    expect(checkSentence('I am at home', "I'm at home.").verdict).toBe('right');
    expect(checkSentence('I don’t know.', 'I do not know.').verdict).toBe('right');
    expect(checkSentence('  Where   is the   cat ', 'Where is the cat?').verdict).toBe('right');
  });

  it('small typos are close, missing or wrong words are wrong', () => {
    expect(checkSentence('I live in a smal house', 'I live in a small house.').verdict).toBe('close');
    const missing = checkSentence('I live a small house', 'I live in a small house.');
    expect(missing.verdict).toBe('wrong');
    expect(missing.marks.filter((m) => m.mark === 'miss').map((m) => m.word)).toEqual(['in']);
    const wrong = checkSentence('I live on a small house', 'I live in a small house.');
    expect(wrong.marks.find((m) => m.mark !== 'ok')?.word).toBe('in');
    const extra = checkSentence('I live in a very small house', 'I live in a small house.');
    expect(extra.verdict).toBe('wrong');
    expect(extra.extra).toEqual(['very']);
    expect(extra.marks.every((m) => m.mark === 'ok')).toBe(true);
    expect(checkSentence('', 'Hello.').verdict).toBe('wrong');
  });

  it('marks a contraction by its worst part', () => {
    const r = checkSentence('I do know', "I don't know.");
    expect(r.verdict).toBe('wrong');
    expect(r.marks.map((m) => m.mark)).toEqual(['ok', 'miss', 'ok']);
  });

  it('from Turkish, he/she/it are the same word', () => {
    expect(checkSentence('She is a doctor', 'He is a doctor.', { fromTurkish: true }).verdict).toBe('right');
    expect(checkSentence('I saw her book', 'I saw his book.', { fromTurkish: true }).verdict).toBe('right');
    expect(checkSentence('She is a doctor', 'He is a doctor.').verdict).toBe('wrong');
  });

  it('shows the answer unmarked and counts words', () => {
    expect(revealSentence("I'm here.").marks).toEqual([
      { word: "I'm", mark: 'ok' },
      { word: 'here.', mark: 'ok' },
    ]);
    expect(wordsToType("I don't know, Tom.")).toBe(4);
  });
});
