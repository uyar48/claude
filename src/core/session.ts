// Time-driven lesson engine. A lesson keeps serving exercises until the target
// time is reached, then closes with an easy speed round.
//
//   warm-up   easy reviews of due words (≤ 35 % of the time)
//   learn     new words in small batches: intro card → match → easy check
//   practice  mixed exercises; difficulty rises with elapsed time; readings,
//             a picture scene, sentences, dictation …
//   close     60-second speed round on known words (a sense of success)
//
// Rules: at most 2 exercises of the same type in a row; types are rotated so
// a lesson uses many of them. Pure and deterministic (seeded) for testing.

import type { Course } from '../content/courseTypes.js';
import { knownLemmas, sentenceTokens, sentenceUsable } from './course.js';
import type { Card } from './srs.js';

export type ExerciseType =
  | 'intro'
  | 'match'
  | 'word-to-picture'
  | 'picture-to-word'
  | 'listen-picture'
  | 'en-tr'
  | 'tr-en'
  | 'dictation'
  | 'fill-blank'
  | 'build-sentence'
  | 'reading'
  | 'scene'
  | 'speed-round';

export const DIFFICULTY: Record<ExerciseType, 1 | 2 | 3> = {
  intro: 1,
  match: 1,
  'word-to-picture': 1,
  'picture-to-word': 1,
  'en-tr': 1,
  scene: 1,
  'speed-round': 1,
  'listen-picture': 2,
  'tr-en': 2,
  'fill-blank': 2,
  reading: 2,
  dictation: 3,
  'build-sentence': 3,
};

const SINGLE_WORD: ExerciseType[] = [
  'word-to-picture',
  'picture-to-word',
  'listen-picture',
  'en-tr',
  'tr-en',
  'dictation',
  'fill-blank',
  'build-sentence',
];
const VISUAL_ONLY: ExerciseType[] = ['word-to-picture', 'picture-to-word'];

export const CLOSE_MS = 75_000;
const WARMUP_SHARE = 0.35;
const BATCH = 4;
const MAX_SAME_IN_ROW = 2;
/** Other exercises between two readings. */
const READING_GAP_MS = 8 * 60_000;
/** Time a reading (or scene) needs; not started when less remains. */
const READING_NEEDS_MS = 4 * 60_000 + CLOSE_MS;
const SCENE_NEEDS_MS = 90_000 + CLOSE_MS;

export interface Exercise {
  key: string;
  type: ExerciseType;
  /** Target word (single-word exercises, intro). */
  wordId?: string;
  /** Option words for choices (answer = index), or the set for match/scene/speed. */
  words?: string[];
  answer?: number;
  sentenceId?: string;
  /** Index into sentenceTokens() of the gap (fill-blank). */
  gapIndex?: number;
  textId?: string;
}

export interface SessionState {
  id: string;
  number: number;
  targetMs: number;
  activeMs: number;
  newWords: string[];
  reviewWords: string[];
  introduced: string[];
  reviewed: string[];
  phase: 'warmup' | 'learn' | 'practice' | 'close' | 'done';
  queue: Exercise[];
  history: Array<{ type: ExerciseType; wordId?: string; correct: boolean | null }>;
  word: Record<string, { seen: number; correct: number }>;
  graded: string[];
  usedSentences: string[];
  usedTexts: string[];
  lastReadingMs: number;
  seq: number;
  seed: number;
}

export interface SessionContext {
  course: Course;
  cards: ReadonlyMap<string, Card>;
  /** The word has a picture or an emoji. */
  hasVisual: (wordId: string) => boolean;
}

export interface AnswerResult {
  /** Single-word exercises. null = not graded (intro, reading summary …). */
  correct: boolean | null;
  /** Active time spent on the exercise. */
  ms: number;
  /** Results for set exercises (match, scene, speed round, reading). */
  perWord?: Record<string, boolean>;
}

export interface Grade {
  wordId: string;
  grade: 'good' | 'again';
}

export function createSession(opts: {
  id: string;
  number: number;
  targetMinutes: number;
  newWords: string[];
  reviewWords: string[];
  seed?: number;
}): SessionState {
  return {
    id: opts.id,
    number: opts.number,
    targetMs: opts.targetMinutes * 60_000,
    activeMs: 0,
    newWords: opts.newWords,
    reviewWords: opts.reviewWords,
    introduced: [],
    reviewed: [],
    phase: opts.reviewWords.length ? 'warmup' : opts.newWords.length ? 'learn' : 'practice',
    queue: [],
    history: [],
    word: {},
    graded: [],
    usedSentences: [],
    usedTexts: [],
    lastReadingMs: 0,
    seq: 0,
    seed: opts.seed ?? hashString(opts.id),
  };
}

// ---------- next exercise ----------

export function nextExercise(s0: SessionState, ctx: SessionContext): { state: SessionState; exercise: Exercise | null } {
  let s: SessionState = { ...s0 };
  if (s.phase === 'done') return { state: s, exercise: null };

  if (s.queue.length) {
    const [exercise, ...rest] = s.queue;
    return { state: { ...s, queue: rest }, exercise };
  }

  const remaining = s.targetMs - s.activeMs;
  if (s.phase !== 'close' && remaining <= CLOSE_MS) s = { ...s, phase: 'close' };

  if (s.phase === 'close') {
    const already = s.history.some((h) => h.type === 'speed-round');
    const words = speedWords(s, ctx);
    if (already || words.length < 4) return { state: { ...s, phase: 'done' }, exercise: null };
    return emit(s, { type: 'speed-round', words });
  }

  if (s.phase === 'warmup') {
    const todo = s.reviewWords.filter((w) => !s.reviewed.includes(w));
    if (todo.length && s.activeMs < s.targetMs * WARMUP_SHARE) {
      const w = todo[0];
      const type = pickType(s, ctx, w, ['word-to-picture', 'en-tr', 'picture-to-word', 'listen-picture'], 2);
      if (type) return emit({ ...s, reviewed: [...s.reviewed, w] }, buildSingle(s, ctx, type, w));
      s = { ...s, reviewed: [...s.reviewed, w] };
      return nextExercise(s, ctx);
    }
    s = { ...s, phase: s.newWords.some((w) => !s.introduced.includes(w)) ? 'learn' : 'practice' };
  }

  if (s.phase === 'learn') {
    const pending = s.newWords.filter((w) => !s.introduced.includes(w));
    if (pending.length) {
      const batch = pending.slice(0, pending.length - BATCH === 1 ? BATCH + 1 : BATCH);
      const after = { ...s, introduced: [...s.introduced, ...batch] };
      // intro A, intro B, check A, intro C, check B, … check last, match —
      // never more than two intro cards in a row.
      const planned: Array<Omit<Exercise, 'key'>> = [];
      const check = (w: string) => {
        const at = { ...after, seq: s.seq + planned.length };
        const t = pickType(at, ctx, w, ['word-to-picture', 'en-tr', 'picture-to-word'], 1, planned.map((p) => p.type));
        if (t) planned.push(buildSingle(at, ctx, t, w));
      };
      batch.forEach((w, i) => {
        planned.push({ type: 'intro', wordId: w });
        if (i >= 1) check(batch[i - 1]);
      });
      check(batch[batch.length - 1]);
      if (batch.length >= 3) planned.push({ type: 'match', words: batch });
      const keyed: Exercise[] = planned.map((p, i) => ({ ...p, key: `${s.id}:${s.seq + i}` }));
      const [first, ...rest] = keyed;
      return { state: { ...after, seq: s.seq + keyed.length, queue: rest }, exercise: first };
    }
    s = { ...s, phase: 'practice' };
  }

  // practice
  const f = s.activeMs / s.targetMs;
  const cap: 1 | 2 | 3 = f < 0.45 ? 2 : 3;

  const reading = pickReading(s, ctx);
  const firstReading = s.usedTexts.length === 0;
  if (
    reading &&
    remaining >= READING_NEEDS_MS &&
    (firstReading ? f > 0.2 : s.activeMs - s.lastReadingMs >= READING_GAP_MS)
  ) {
    return emit({ ...s, usedTexts: [...s.usedTexts, reading] }, { type: 'reading', textId: reading });
  }
  if (f > 0.3 && remaining >= SCENE_NEEDS_MS && !s.history.some((h) => h.type === 'scene')) {
    const scene = sceneWords(s, ctx);
    if (scene.length >= 4 && !lastTwoSame(s, 'scene')) return emit(s, { type: 'scene', words: scene });
  }

  for (const w of practiceOrder(s, ctx)) {
    const types = SINGLE_WORD.filter((t) => DIFFICULTY[t] <= cap);
    // Later in the lesson prefer the harder exercises.
    const preferHard = f >= 0.45;
    const t = pickType(s, ctx, w, types, cap, [], preferHard);
    if (t) return emit(s, buildSingle(s, ctx, t, w));
  }
  return nextExercise({ ...s, phase: 'close' }, ctx);
}

function emit(s: SessionState, ex: Omit<Exercise, 'key'>): { state: SessionState; exercise: Exercise } {
  const exercise = { ...ex, key: `${s.id}:${s.seq}` } as Exercise;
  let next = { ...s, seq: s.seq + 1 };
  if (ex.type === 'fill-blank' || ex.type === 'build-sentence') {
    next = { ...next, usedSentences: [...next.usedSentences, ex.sentenceId!] };
  }
  return { state: next, exercise };
}

// ---------- answers ----------

export function recordAnswer(s: SessionState, ex: Exercise, r: AnswerResult): { state: SessionState; grades: Grade[] } {
  const word = { ...s.word };
  const bump = (id: string, ok: boolean) => {
    const cur = word[id] ?? { seen: 0, correct: 0 };
    word[id] = { seen: cur.seen + 1, correct: cur.correct + (ok ? 1 : 0) };
  };
  if (ex.wordId && r.correct !== null && ex.type !== 'intro') bump(ex.wordId, r.correct);
  for (const [id, ok] of Object.entries(r.perWord ?? {})) bump(id, ok);

  const grades: Grade[] = [];
  let graded = s.graded;
  // A due review word is graded once per lesson, on its first exercise.
  if (ex.wordId && r.correct !== null && s.reviewWords.includes(ex.wordId) && !graded.includes(ex.wordId)) {
    grades.push({ wordId: ex.wordId, grade: r.correct ? 'good' : 'again' });
    graded = [...graded, ex.wordId];
  }
  for (const [id, ok] of Object.entries(r.perWord ?? {})) {
    if (s.reviewWords.includes(id) && !graded.includes(id)) {
      grades.push({ wordId: id, grade: ok ? 'good' : 'again' });
      graded = [...graded, id];
    }
  }

  const state: SessionState = {
    ...s,
    activeMs: s.activeMs + Math.max(0, r.ms),
    word,
    graded,
    history: [...s.history, { type: ex.type, wordId: ex.wordId, correct: r.correct }],
    phase: ex.type === 'speed-round' ? 'done' : s.phase,
    // The gap to the next reading counts from the end of this one.
    lastReadingMs: ex.type === 'reading' ? s.activeMs + Math.max(0, r.ms) : s.lastReadingMs,
  };
  return { state, grades };
}

/** Grades for the lesson's new words once it ends: a word that went well moves on. */
export function finalGrades(s: SessionState): Grade[] {
  return s.introduced
    .filter((w) => !s.graded.includes(w))
    .flatMap((w): Grade[] => {
      const st = s.word[w];
      if (!st || st.seen < 2) return [];
      return st.correct / st.seen >= 0.6 ? [{ wordId: w, grade: 'good' }] : [];
    });
}

export function distinctTypes(s: SessionState): ExerciseType[] {
  return [...new Set(s.history.map((h) => h.type))];
}

// ---------- choosing words and types ----------

function sessionKnown(s: SessionState, ctx: SessionContext): Set<string> {
  return knownLemmas(ctx.course, ctx.cards, s.introduced);
}

function practiceOrder(s: SessionState, ctx: SessionContext): string[] {
  const pool = new Set<string>([...s.introduced, ...s.reviewWords]);
  if (pool.size < 6) {
    // Few words in this lesson: also practise recently learned ones.
    const recent = [...ctx.cards.values()]
      .filter((c) => c.state !== 'new' && ctx.course.words[c.wordId])
      .sort((a, b) => (b.introducedAt ?? 0) - (a.introducedAt ?? 0))
      .slice(0, 12)
      .map((c) => c.wordId);
    for (const w of recent) pool.add(w);
  }
  const recent = s.history.slice(-3).map((h) => h.wordId);
  const rand = rng(s.seed + s.seq * 7919);
  return [...pool]
    .filter((w) => !recent.includes(w))
    .map((w) => {
      const st = s.word[w] ?? { seen: 0, correct: 0 };
      const acc = st.seen ? st.correct / st.seen : 0.5;
      const score = (1 - acc) * 2 + 1 / (1 + st.seen) + (s.introduced.includes(w) ? 0.6 : 0) + rand() * 0.3;
      return { w, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.w);
}

function lastTwoSame(s: SessionState, t: ExerciseType, planned: ExerciseType[] = []): boolean {
  const recent = [...s.history.map((h) => h.type), ...s.queue.map((q) => q.type), ...planned].slice(-MAX_SAME_IN_ROW);
  return recent.length === MAX_SAME_IN_ROW && recent.every((x) => x === t);
}

function pickType(
  s: SessionState,
  ctx: SessionContext,
  w: string,
  types: ExerciseType[],
  cap: number,
  planned: ExerciseType[] = [],
  preferHard = false,
): ExerciseType | null {
  const usage = new Map<ExerciseType, number>();
  for (const t of [...s.history.map((h) => h.type), ...planned]) usage.set(t, (usage.get(t) ?? 0) + 1);
  const ok = types.filter((t) => DIFFICULTY[t] <= cap && !lastTwoSame(s, t, planned) && available(s, ctx, t, w));
  if (!ok.length) return null;
  const rand = rng(s.seed + s.seq * 104729 + w.length);
  return ok
    .map((t) => ({ t, k: (usage.get(t) ?? 0) - (preferHard ? DIFFICULTY[t] * 0.75 : 0) + rand() * 0.5 }))
    .sort((a, b) => a.k - b.k)[0].t;
}

function available(s: SessionState, ctx: SessionContext, t: ExerciseType, w: string): boolean {
  const word = ctx.course.words[w];
  if (!word) return false;
  switch (t) {
    case 'word-to-picture':
    case 'picture-to-word':
      return ctx.hasVisual(w) && visualWords(ctx).length >= 4;
    case 'listen-picture':
    case 'en-tr':
    case 'tr-en':
      return true;
    case 'dictation':
      return word.en.length >= 3;
    case 'fill-blank':
      return findSentence(s, ctx, w, 'blank') !== null;
    case 'build-sentence':
      return findSentence(s, ctx, w, 'build') !== null;
    default:
      return false;
  }
}

function buildSingle(s: SessionState, ctx: SessionContext, type: ExerciseType, w: string): Omit<Exercise, 'key'> {
  if (type === 'fill-blank' || type === 'build-sentence') {
    const found = findSentence(s, ctx, w, type === 'fill-blank' ? 'blank' : 'build')!;
    return { type, wordId: w, sentenceId: found.id, gapIndex: found.gapIndex };
  }
  if (type === 'dictation') return { type, wordId: w };
  const visual = (VISUAL_ONLY.includes(type) || type === 'listen-picture') && ctx.hasVisual(w);
  const wrong = distractors(s, ctx, w, 3, visual);
  const rand = rng(s.seed + s.seq * 31 + w.length);
  const index = Math.floor(rand() * (wrong.length + 1));
  const words = [...wrong];
  words.splice(index, 0, w);
  return { type, wordId: w, words, answer: index };
}

function distractors(s: SessionState, ctx: SessionContext, w: string, n: number, visual: boolean): string[] {
  const known = sessionKnown(s, ctx);
  const target = ctx.course.words[w];
  const rand = rng(s.seed + s.seq * 131 + w.length * 17);
  return ctx.course.order
    .filter((id) => id !== w && (!visual || ctx.hasVisual(id)))
    .filter((id) => ctx.course.words[id].tr !== target.tr)
    .map((id) => ({ id, k: (known.has(id) ? 0 : 1) + (ctx.course.words[id].kind === target.kind ? 0 : 0.5) + rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.id);
}

function visualWords(ctx: SessionContext): string[] {
  return ctx.course.order.filter((id) => ctx.hasVisual(id));
}

/** A usable sentence for this word: all its words known (or ≥95 % coverage). */
export function findSentence(
  s: SessionState,
  ctx: SessionContext,
  w: string,
  mode: 'blank' | 'build',
): { id: string; gapIndex?: number } | null {
  const known = sessionKnown(s, ctx);
  for (const sent of ctx.course.sentences) {
    if (!sent.lemmas.includes(w) || s.usedSentences.includes(sent.id)) continue;
    if (!sentenceUsable(ctx.course, sent, known)) continue;
    const toks = sentenceTokens(ctx.course, sent.en);
    const wordToks = toks.filter((t) => t.lemma !== undefined);
    if (mode === 'build') {
      if (wordToks.length >= 3 && wordToks.length <= 7) return { id: sent.id };
      continue;
    }
    const gapIndex = toks.findIndex((t) => t.lemma === w && !/['’]/.test(t.text));
    if (gapIndex >= 0 && wordToks.length >= 2) return { id: sent.id, gapIndex };
  }
  return null;
}

function pickReading(s: SessionState, ctx: SessionContext): string | null {
  const known = sessionKnown(s, ctx);
  const fresh = ctx.course.texts.filter((t) => !s.usedTexts.includes(t.id) && sentenceUsable(ctx.course, t, known));
  if (!fresh.length) return null;
  // Prefer texts with this lesson's new words.
  const score = (t: (typeof fresh)[number]) => t.lemmas.filter((l) => s.introduced.includes(l)).length;
  return fresh.sort((a, b) => score(b) - score(a) || a.maxOrder - b.maxOrder)[0].id;
}

function sceneWords(s: SessionState, ctx: SessionContext): string[] {
  const pool = [...new Set([...s.introduced, ...s.reviewWords])].filter((w) => ctx.hasVisual(w));
  const extra = [...ctx.cards.values()].filter((c) => c.state !== 'new' && ctx.hasVisual(c.wordId)).map((c) => c.wordId);
  return [...new Set([...pool, ...extra])].slice(0, 6);
}

function speedWords(s: SessionState, ctx: SessionContext): string[] {
  const known = [...ctx.cards.values()].filter((c) => c.state === 'known').map((c) => c.wordId);
  const words = [...new Set([...known, ...s.introduced, ...s.reviewWords])].filter((w) => ctx.course.words[w]);
  // Easy: the best-answered words first.
  return words
    .sort((a, b) => acc(s, b) - acc(s, a))
    .slice(0, 16);
}

function acc(s: SessionState, w: string): number {
  const st = s.word[w];
  return st && st.seen ? st.correct / st.seen : 0.7;
}

// ---------- tiny deterministic RNG ----------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
