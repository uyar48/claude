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
//
// The pace follows the learner: when the last answers were mostly right the
// harder exercises come sooner and the easiest ones drop out; when many were
// wrong the lesson stays with easier ones (see pace()). Writing exercises
// (typed gaps, sentence dictation, Turkish → English) use only words learned
// in earlier lessons and short sentences; writing from Turkish opens in Unit 2.

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
  | 'speed-round'
  | 'grammar'
  | 'type-blank'
  | 'dictate-sentence'
  | 'write-sentence';

export const DIFFICULTY: Record<ExerciseType, 1 | 2 | 3> = {
  intro: 1,
  match: 1,
  'word-to-picture': 1,
  'picture-to-word': 1,
  'en-tr': 1,
  scene: 1,
  'speed-round': 1,
  grammar: 1,
  'listen-picture': 2,
  'tr-en': 2,
  'fill-blank': 2,
  reading: 2,
  dictation: 3,
  'build-sentence': 3,
  'type-blank': 3,
  'dictate-sentence': 3,
  'write-sentence': 3,
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
  'type-blank',
  'dictate-sentence',
  'write-sentence',
];
const VISUAL_ONLY: ExerciseType[] = ['word-to-picture', 'picture-to-word'];
/** Exercises where the learner writes English (not chooses it). */
export const WRITING: ExerciseType[] = ['type-blank', 'dictate-sentence', 'write-sentence'];
/** The easiest ones, dropped when the learner is doing very well. */
const EASIEST: ExerciseType[] = ['word-to-picture', 'picture-to-word', 'en-tr'];

/** The closing speed round lasts this long; it starts when this much time is left. */
export const CLOSE_MS = 60_000;
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
  /** Grammar card id. */
  grammarId?: string;
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
  /** Grammar cards planned for this lesson (id + the word that brings it). */
  grammar?: Array<{ id: string; word: string }>;
  grammarShown?: string[];
  /** How often each pace was used when choosing practice exercises. */
  paces?: Partial<Record<Pace, number>>;
}

export type Pace = 'easier' | 'normal' | 'harder';

export interface SessionContext {
  course: Course;
  cards: ReadonlyMap<string, Card>;
  /** The word has a picture or an emoji. */
  hasVisual: (wordId: string) => boolean;
  /** The learner's unit: longer sentences and texts of later units stay closed. */
  unit?: number;
  /** How often each text was read in earlier lessons (unread texts come first). */
  readCounts?: Readonly<Record<string, number>>;
  /** Share of right answers in the last lessons (sets the pace until this one has enough answers). */
  priorAccuracy?: number | null;
}

/** Most tiles in a "build the sentence" exercise, by unit. */
const BUILD_MAX_TILES = [7, 7, 8, 9, 10];
/** Longest sentence (words) to write from listening, by unit. */
const DICTATE_MAX_WORDS = [5, 6, 7, 8, 9];
/** Longest sentence (words) to write from Turkish, by unit (none in Unit 1). */
const WRITE_MAX_WORDS = [0, 6, 7, 8, 9];
const byUnit = (table: number[], unit = 1) => table[Math.min(table.length, Math.max(1, unit)) - 1];
const buildMax = (unit = 1) => byUnit(BUILD_MAX_TILES, unit);

/** Answers that set the pace. */
const PACE_WINDOW = 10;
const PACE_MIN_ANSWERS = 5;
const PACE_HARDER = 0.85;
const PACE_EASIER = 0.6;
/** Once hard exercises are open: a writing exercise after this many others (by pace). */
const WRITING_EVERY: Record<Pace, number> = { easier: Infinity, normal: 3, harder: 2 };

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
  grammar?: Array<{ id: string; word: string }>;
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
    grammar: opts.grammar ?? [],
    grammarShown: [],
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
      // Going well: the warm-up asks the other way round (English from Turkish, from sound).
      const types: ExerciseType[] =
        pace(s, ctx) === 'harder'
          ? ['listen-picture', 'tr-en', 'picture-to-word', 'en-tr']
          : ['word-to-picture', 'en-tr', 'picture-to-word', 'listen-picture'];
      const type = pickType(s, ctx, w, types, 2);
      if (type) return emit({ ...s, reviewed: [...s.reviewed, w] }, buildSingle(s, ctx, type, w));
      s = { ...s, reviewed: [...s.reviewed, w] };
      return nextExercise(s, ctx);
    }
    s = { ...s, phase: s.newWords.some((w) => !s.introduced.includes(w)) ? 'learn' : 'practice' };
  }

  // Grammar cards for words learned in earlier lessons come right after the warm-up.
  const catchUp = (s.grammar ?? []).find((g) => !s.newWords.includes(g.word) && !(s.grammarShown ?? []).includes(g.id));
  if (catchUp && (s.phase === 'learn' || s.phase === 'practice')) {
    return emit({ ...s, grammarShown: [...(s.grammarShown ?? []), catchUp.id] }, { type: 'grammar', grammarId: catchUp.id });
  }

  if (s.phase === 'learn') {
    const pending = s.newWords.filter((w) => !s.introduced.includes(w));
    if (pending.length) {
      const batch = pending.slice(0, pending.length - BATCH === 1 ? BATCH + 1 : BATCH);
      const after: SessionState = { ...s, introduced: [...s.introduced, ...batch] };
      // intro A, intro B, check A, intro C, check B, … check last, match —
      // never more than two intro cards in a row.
      const planned: Array<Omit<Exercise, 'key'>> = [];
      const check = (w: string) => {
        const at = { ...after, seq: s.seq + planned.length };
        const t = pickType(at, ctx, w, ['word-to-picture', 'en-tr', 'picture-to-word'], 1, planned.map((p) => p.type));
        if (t) planned.push(buildSingle(at, ctx, t, w));
      };
      const shown = [...(s.grammarShown ?? [])];
      batch.forEach((w, i) => {
        planned.push({ type: 'intro', wordId: w });
        // A grammar card right after the word that brings it.
        for (const g of s.grammar ?? []) {
          if (g.word === w && !shown.includes(g.id)) {
            planned.push({ type: 'grammar', grammarId: g.id });
            shown.push(g.id);
          }
        }
        if (i >= 1) check(batch[i - 1]);
      });
      check(batch[batch.length - 1]);
      if (batch.length >= 3) planned.push({ type: 'match', words: batch });
      const keyed: Exercise[] = planned.map((p, i) => ({ ...p, key: `${s.id}:${s.seq + i}` }));
      const [first, ...rest] = keyed;
      return { state: { ...after, grammarShown: shown, seq: s.seq + keyed.length, queue: rest }, exercise: first };
    }
    s = { ...s, phase: 'practice' };
  }

  // practice
  const f = s.activeMs / s.targetMs;
  const p = pace(s, ctx);
  // Hard exercises (writing, dictation, building) open earlier or later with the pace.
  const hardFrom = p === 'harder' ? 0.2 : p === 'easier' ? 0.7 : 0.45;
  const cap: 1 | 2 | 3 = f < hardFrom ? 2 : 3;

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

  // Later in the lesson prefer the harder exercises (never when it is going badly);
  // when it goes very well, leave out the easiest ones.
  const preferHard = p === 'easier' ? 0 : f >= hardFrom ? (p === 'harder' ? 1.2 : 0.75) : 0;
  const all = SINGLE_WORD.filter((t) => DIFFICULTY[t] <= cap);
  const lists = p === 'harder' && f >= hardFrom ? [all.filter((t) => !EASIEST.includes(t)), all] : [all];
  const paced = { ...s, paces: { ...s.paces, [p]: (s.paces?.[p] ?? 0) + 1 } };
  // Writing works with words from earlier lessons, so it gets its own turn.
  if (cap === 3 && sinceWriting(s) >= WRITING_EVERY[p]) {
    for (const w of writingCandidates(s, ctx)) {
      const t = pickType(s, ctx, w, WRITING, cap, [], preferHard);
      if (t) return emit(paced, buildSingle(s, ctx, t, w));
    }
  }
  for (const types of lists) {
    for (const w of practiceOrder(s, ctx)) {
      const t = pickType(s, ctx, w, types, cap, [], preferHard);
      if (t) return emit(paced, buildSingle(s, ctx, t, w));
    }
  }
  return nextExercise({ ...s, phase: 'close' }, ctx);
}

function emit(s: SessionState, ex: Omit<Exercise, 'key'>): { state: SessionState; exercise: Exercise } {
  const exercise = { ...ex, key: `${s.id}:${s.seq}` } as Exercise;
  let next = { ...s, seq: s.seq + 1 };
  if (ex.sentenceId) next = { ...next, usedSentences: [...next.usedSentences, ex.sentenceId] };
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

/**
 * The pace from the last answers of this lesson. Until there are enough, the
 * earlier lessons fill in (priorAccuracy); with nothing to go on: normal.
 */
export function pace(s: SessionState, ctx: SessionContext): Pace {
  const recent = s.history.filter((h) => h.correct !== null && h.type !== 'speed-round').slice(-PACE_WINDOW);
  const right = recent.filter((h) => h.correct).length;
  let acc: number;
  if (recent.length >= PACE_MIN_ANSWERS) acc = right / recent.length;
  else if (typeof ctx.priorAccuracy === 'number') {
    const missing = PACE_MIN_ANSWERS - recent.length;
    acc = (right + ctx.priorAccuracy * missing) / PACE_MIN_ANSWERS;
  } else return 'normal';
  return acc >= PACE_HARDER ? 'harder' : acc < PACE_EASIER ? 'easier' : 'normal';
}

/** The pace used most in this lesson's practice (for the finish screen). */
export function lessonPace(s: SessionState): Pace {
  const c = s.paces ?? {};
  const total = (c.easier ?? 0) + (c.normal ?? 0) + (c.harder ?? 0);
  if (!total) return 'normal';
  if ((c.harder ?? 0) / total >= 0.5) return 'harder';
  if ((c.easier ?? 0) / total >= 0.3) return 'easier';
  return 'normal';
}

// ---------- unit test ----------

export const UNIT_TEST_SIZE = 20;
const TEST_TYPES: ExerciseType[] = [
  'en-tr',
  'picture-to-word',
  'listen-picture',
  'tr-en',
  'fill-blank',
  'dictation',
  'type-blank',
  'dictate-sentence',
];

/**
 * A short test over a unit's words (all introduced): one question per word,
 * types rotated, easy ones first. Deterministic for a seed.
 */
export function unitTestExercises(ctx: SessionContext, unit: number, seed: number, n = UNIT_TEST_SIZE): Exercise[] {
  const learned = (ctx.course.units.find((u) => u.n === unit)?.words ?? []).filter(
    (w) => (ctx.cards.get(w)?.state ?? 'new') !== 'new',
  );
  const rand = rng(seed);
  const words = learned
    .map((w) => ({ w, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.w);
  let s = createSession({ id: `test-${unit}-${seed}`, number: 0, targetMinutes: 30, newWords: [], reviewWords: [], seed });
  const out: Exercise[] = [];
  for (const w of words) {
    if (out.length >= n) break;
    // About a third of the questions are written answers.
    const cap = out.filter((e) => DIFFICULTY[e.type] === 3).length >= Math.round(n * 0.3) ? 2 : 3;
    const t = pickType(s, ctx, w, TEST_TYPES, cap);
    if (!t) continue;
    const step = emit(s, buildSingle(s, ctx, t, w));
    out.push(step.exercise);
    s = { ...step.state, history: [...step.state.history, { type: t, wordId: w, correct: true }] };
  }
  return out.sort((a, b) => DIFFICULTY[a.type] - DIFFICULTY[b.type]);
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

/** Exercises since the last writing one (all of them if none yet). */
function sinceWriting(s: SessionState): number {
  let n = 0;
  for (let i = s.history.length - 1; i >= 0 && !WRITING.includes(s.history[i].type); i--) n++;
  return n;
}

/** Words from earlier lessons to write: this lesson's reviews, then recently learned words. */
function writingCandidates(s: SessionState, ctx: SessionContext): string[] {
  const recent = [...ctx.cards.values()]
    .filter((c) => c.state !== 'new' && ctx.course.words[c.wordId] && !s.newWords.includes(c.wordId))
    .sort((a, b) => (b.introducedAt ?? 0) - (a.introducedAt ?? 0))
    .slice(0, 20)
    .map((c) => c.wordId);
  const used = new Set(s.history.slice(-6).map((h) => h.wordId));
  const rand = rng(s.seed + s.seq * 6151);
  return [...new Set([...s.reviewWords, ...recent])]
    .filter((w) => !used.has(w))
    .map((w) => ({ w, k: rand() + (s.reviewWords.includes(w) ? 0 : 0.5) }))
    .sort((a, b) => a.k - b.k)
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
  /** Weight towards harder types (0 = none). */
  preferHard = 0,
): ExerciseType | null {
  const usage = new Map<ExerciseType, number>();
  for (const t of [...s.history.map((h) => h.type), ...planned]) usage.set(t, (usage.get(t) ?? 0) + 1);
  const ok = types.filter((t) => DIFFICULTY[t] <= cap && !lastTwoSame(s, t, planned) && available(s, ctx, t, w));
  if (!ok.length) return null;
  const rand = rng(s.seed + s.seq * 104729 + w.length);
  return ok
    .map((t) => ({ t, k: (usage.get(t) ?? 0) - DIFFICULTY[t] * preferHard + rand() * 0.5 }))
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
    case 'type-blank':
      return writingOk(s, ctx, w) && findSentence(s, ctx, w, 'type') !== null;
    case 'dictate-sentence':
      return writingOk(s, ctx, w) && findSentence(s, ctx, w, 'dictate') !== null;
    case 'write-sentence':
      return byUnit(WRITE_MAX_WORDS, ctx.unit) > 0 && writingOk(s, ctx, w) && findSentence(s, ctx, w, 'write') !== null;
    default:
      return false;
  }
}

/** Writing uses words from earlier lessons only, and not while the lesson is going badly. */
function writingOk(s: SessionState, ctx: SessionContext, w: string): boolean {
  return !s.newWords.includes(w) && (ctx.cards.get(w)?.state ?? 'new') !== 'new' && pace(s, ctx) !== 'easier';
}

const SENTENCE_MODE: Partial<Record<ExerciseType, SentenceMode>> = {
  'fill-blank': 'blank',
  'build-sentence': 'build',
  'type-blank': 'type',
  'dictate-sentence': 'dictate',
  'write-sentence': 'write',
};

function buildSingle(s: SessionState, ctx: SessionContext, type: ExerciseType, w: string): Omit<Exercise, 'key'> {
  const mode = SENTENCE_MODE[type];
  if (mode) {
    const found = findSentence(s, ctx, w, mode)!;
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

type SentenceMode = 'blank' | 'build' | 'type' | 'dictate' | 'write';

/**
 * A usable sentence for this word: all its words known (or ≥95 % coverage).
 * Sentences the learner writes must be short and use known words only.
 */
export function findSentence(
  s: SessionState,
  ctx: SessionContext,
  w: string,
  mode: SentenceMode,
): { id: string; gapIndex?: number } | null {
  const known = sessionKnown(s, ctx);
  for (const sent of ctx.course.sentences) {
    if (!sent.lemmas.includes(w) || s.usedSentences.includes(sent.id)) continue;
    // Longer sentences belong to later units.
    if ((sent.unit ?? 1) > (ctx.unit ?? Infinity)) continue;
    if (!sentenceUsable(ctx.course, sent, known)) continue;
    const toks = sentenceTokens(ctx.course, sent.en);
    const wordToks = toks.filter((t) => t.lemma !== undefined);
    if (mode === 'build') {
      if (wordToks.length >= 3 && wordToks.length <= buildMax(ctx.unit)) return { id: sent.id };
      continue;
    }
    if (mode === 'dictate' || mode === 'write') {
      const max = byUnit(mode === 'dictate' ? DICTATE_MAX_WORDS : WRITE_MAX_WORDS, ctx.unit);
      const allKnown = sent.lemmas.every((l) => known.has(l));
      if (allKnown && wordToks.length >= 3 && wordToks.length <= max) return { id: sent.id };
      continue;
    }
    const gapIndex = toks.findIndex((t) => t.lemma === w && !/['’]/.test(t.text));
    if (gapIndex < 0 || wordToks.length < 2) continue;
    // A typed gap: a short sentence and a word worth typing.
    if (mode === 'type' && (wordToks.length > buildMax(ctx.unit) || toks[gapIndex].text.length < 2)) continue;
    return { id: sent.id, gapIndex };
  }
  return null;
}

function pickReading(s: SessionState, ctx: SessionContext): string | null {
  const known = sessionKnown(s, ctx);
  const fresh = ctx.course.texts.filter(
    (t) => !s.usedTexts.includes(t.id) && (t.unit ?? 1) <= (ctx.unit ?? Infinity) && sentenceUsable(ctx.course, t, known),
  );
  if (!fresh.length) return null;
  // Texts not read yet first; then texts with this lesson's new words; then the newest unit's.
  const reads = (t: (typeof fresh)[number]) => ctx.readCounts?.[t.id] ?? 0;
  const score = (t: (typeof fresh)[number]) => t.lemmas.filter((l) => s.introduced.includes(l)).length;
  return fresh.sort(
    (a, b) => reads(a) - reads(b) || score(b) - score(a) || (b.unit ?? 1) - (a.unit ?? 1) || a.maxOrder - b.maxOrder,
  )[0].id;
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
