import { describe, expect, it } from 'vitest';
import courseJson from '../content/build/course.json';
import type { Course } from '../src/content/courseTypes';
import type { ImageCredits } from '../src/content/types';
import { validateCourse } from './validate-content';

const course = courseJson as unknown as Course;
const media = { images: {}, audio: {} };
const photos = (): ImageCredits => ({
  generatedAt: null,
  missingKeys: [],
  words: Object.fromEntries(
    Object.values(course.words)
      .filter((w) => w.kind === 'concrete')
      .map((w) => [
        w.id,
        { default: 0, candidates: [{ file: `${w.id}.jpg`, source: 'openverse' as const, url: 'u', author: 'a', license: 'CC BY 2.0', width: 800, height: 600 }] },
      ]),
  ),
});

describe('validate-content', () => {
  it('the built course passes: ≥ 3 sentences per word, attributed sentences, readable texts', () => {
    const r = validateCourse(course, photos(), media, () => true);
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(r.sample).toHaveLength(20);
  });

  it('reports concrete words without photos and broken attribution', () => {
    const broken: Course = {
      ...course,
      sentences: course.sentences.map((s, i) => (i === 200 && s.src === 'tatoeba' ? { ...s, trOwner: undefined } : s)),
    };
    const r = validateCourse(broken, { generatedAt: null, missingKeys: [], words: {} }, media, () => true);
    const errors = r.findings.filter((f) => f.level === 'error').map((f) => f.what);
    expect(errors.some((e) => e.startsWith('house: concrete word without a photo'))).toBe(true);
    expect(errors.some((e) => /Tatoeba attribution incomplete/.test(e))).toBe(true);
  });

  it('rejected Tatoeba sentences must not be in the course', () => {
    const id = Number(course.sentences.find((s) => s.src === 'tatoeba')!.id.slice(2));
    const r = validateCourse(course, photos(), media, () => true, [id]);
    expect(r.findings.some((f) => /rejected sentence/.test(f.what))).toBe(true);
  });
});
