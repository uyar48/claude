// Builds content/build/course.json from:
//   content/ngsl/*            NGSL 1.2 (CC BY-SA 4.0) — word order and forms
//   content/units/unit-NN.*   our word glosses, own sentences and reading texts
//   content/tatoeba/en-tr.json filtered Tatoeba pairs (CC BY 2.0 FR)
//
//   npm run build-content
//
// A sentence enters the course only if every word in it is an NGSL word of a
// built unit (or a name), so it can be gated by the learner's progress.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Course, CourseGrammar, CourseSentence, CourseText, CourseWord, WordKind } from '../src/content/courseTypes';
import { courseOrder, DISPLAY, formIndex, lemmatize, loadNgsl, STARTER_KNOWN, UNIT_SIZE } from './content/lexicon';

/** At most this many Tatoeba sentences per word (the newest word in the sentence). */
const TATOEBA_PER_WORD = 12;
/**
 * Longest Tatoeba sentence (in words) per unit. Reading grows step by step:
 * Unit 1 stays as it was; from Unit 2 a little longer each unit.
 */
export const MAX_WORDS_BY_UNIT = [9, 10, 12, 14, 16];

export const wordCount = (en: string) => en.trim().split(/\s+/).length;

/** First unit in which a sentence of this length may be used. */
export function unitForLength(words: number): number {
  const i = MAX_WORDS_BY_UNIT.findIndex((max) => words <= max);
  return i < 0 ? Infinity : i + 1;
}

interface UnitWordsFile {
  unit: number;
  title: string;
  titleTr: string;
  words: Array<{ id: string; tr: string; pos: string; kind: WordKind; emoji?: string; query?: string }>;
}
interface OwnSentencesFile {
  sentences: Array<{ en: string; tr: string }>;
}
interface TextsFile {
  texts: Array<Omit<CourseText, 'lemmas' | 'maxOrder'>>;
}
interface TatoebaFile {
  pairs: Array<{ enId: number; trId: number; en: string; tr: string; enOwner: string; trOwner: string }>;
}

const read = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
const exists = (p: string) => fs.existsSync(p);

/** Tatoeba sentences we reject (idiomatic or confusing for beginners). */
const REJECTED = new Set<number>(exists('content/tatoeba/rejected.json') ? read<{ ids: number[] }>('content/tatoeba/rejected.json').ids : []);


export function buildCourse(): { course: Course; report: string[] } {
  const report: string[] = [];
  const lemmas = loadNgsl();
  const idx = formIndex(lemmas);
  const rank = new Map(lemmas.map((l) => [l.lemma, l.rank]));
  const formsOf = new Map(lemmas.map((l) => [l.lemma, l.forms]));
  const fullOrder = courseOrder(lemmas);

  // ---------- units with authored glosses ----------
  const words: Record<string, CourseWord> = {};
  const units: Course['units'] = [];
  for (let n = 1; exists(`content/units/unit-${String(n).padStart(2, '0')}.words.json`); n++) {
    const file = read<UnitWordsFile>(`content/units/unit-${String(n).padStart(2, '0')}.words.json`);
    const expected = fullOrder.slice((n - 1) * UNIT_SIZE, n * UNIT_SIZE);
    const got = file.words.map((w) => w.id);
    const missing = expected.filter((w) => !got.includes(w));
    const extra = got.filter((w) => !expected.includes(w));
    if (missing.length || extra.length) {
      throw new Error(`unit ${n}: words do not match the course order. missing: ${missing.join(', ')} extra: ${extra.join(', ')}`);
    }
    for (const w of file.words) {
      words[w.id] = {
        id: w.id,
        en: DISPLAY[w.id] ?? w.id,
        tr: w.tr,
        pos: w.pos,
        kind: w.kind,
        ...(w.emoji ? { emoji: w.emoji } : {}),
        ...(w.query ? { query: w.query } : {}),
        // Everyday words outside NGSL have no rank.
        rank: (rank.get(w.id) ?? -1) >= 0 ? rank.get(w.id)! : null,
        order: fullOrder.indexOf(w.id),
        unit: n,
      };
    }
    units.push({ n, title: file.title, titleTr: file.titleTr, words: expected });
  }
  const order = fullOrder.filter((w) => words[w]);
  const position = new Map(order.map((w, i) => [w, i]));
  /** Unit of the newest word of a sentence (starter words count as unit 1). */
  const unitOf = (maxOrder: number) => (maxOrder < 0 ? 1 : words[order[maxOrder]].unit);

  // Forms of course words (tap-to-read and coverage on the client).
  const forms: Record<string, string> = {};
  for (const w of order) for (const f of formsOf.get(w) ?? [w]) if (idx.get(f) === w) forms[f] = w;

  /** Lemmas of a sentence, or null if it uses a word outside the built units. */
  const analyse = (en: string): { lemmas: string[]; maxOrder: number } | null => {
    const toks = lemmatize(en, idx);
    const set = new Set<string>();
    for (const t of toks) {
      if (t === null) return null;
      if (typeof t === 'object') continue; // a name
      if (!position.has(t)) return null;
      set.add(t);
    }
    if (set.size === 0) return null;
    const maxOrder = Math.max(...[...set].map((l) => (STARTER_KNOWN.includes(l) ? -1 : position.get(l)!)));
    return { lemmas: [...set], maxOrder };
  };

  // ---------- sentences ----------
  const sentences: CourseSentence[] = [];
  const seen = new Set<string>();
  const key = (en: string) => en.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

  for (let n = 1; n <= units.length; n++) {
    const p = `content/units/unit-${String(n).padStart(2, '0')}.sentences.json`;
    if (!exists(p)) continue;
    read<OwnSentencesFile>(p).sentences.forEach((s, i) => {
      const a = analyse(s.en);
      if (!a) throw new Error(`own sentence uses a word outside the course units: "${s.en}"`);
      if (seen.has(key(s.en))) return;
      seen.add(key(s.en));
      // Own sentences are written for their unit; they are not length-gated.
      sentences.push({ id: `o:${n}-${i + 1}`, en: s.en, tr: s.tr, src: 'okuma', ...a, unit: unitOf(a.maxOrder) });
    });
  }

  if (exists('content/tatoeba/en-tr.json')) {
    // Candidates grouped by the newest course word they contain.
    const byWord = new Map<string, Array<{ p: TatoebaFile['pairs'][number]; a: { lemmas: string[]; maxOrder: number }; unit: number }>>();
    for (const p of read<TatoebaFile>('content/tatoeba/en-tr.json').pairs) {
      if (REJECTED.has(p.enId)) continue;
      const a = analyse(p.en);
      if (!a) continue;
      const unit = Math.max(unitOf(a.maxOrder), unitForLength(wordCount(p.en)));
      if (!Number.isFinite(unit) || unit > units.length) continue;
      const newest = a.maxOrder < 0 ? 'starter' : order[a.maxOrder];
      if (!byWord.has(newest)) byWord.set(newest, []);
      byWord.get(newest)!.push({ p, a, unit });
    }
    for (const [newest, list] of byWord) {
      // Shorter sentences first; "Tom" sentences after the others.
      list.sort(
        (x, y) =>
          x.p.en.length - y.p.en.length || Number(/Tom\b/.test(x.p.en)) - Number(/Tom\b/.test(y.p.en)) || x.p.enId - y.p.enId,
      );
      const wordUnit = newest === 'starter' ? 1 : words[newest].unit;
      // Unit 1 keeps the shortest sentences. Later units spread the choice
      // over the allowed lengths, so longer sentences come in gradually.
      let picked = list.filter((x) => !seen.has(key(x.p.en)));
      if (wordUnit > 1 && picked.length > TATOEBA_PER_WORD) {
        const step = (picked.length - 1) / (TATOEBA_PER_WORD - 1);
        picked = Array.from({ length: TATOEBA_PER_WORD }, (_, i) => picked[Math.round(i * step)]);
      }
      let n = 0;
      for (const { p, a, unit } of picked) {
        if (n >= TATOEBA_PER_WORD || seen.has(key(p.en))) continue;
        seen.add(key(p.en));
        n++;
        sentences.push({
          id: `t:${p.enId}`,
          en: p.en,
          tr: p.tr,
          src: 'tatoeba',
          enOwner: p.enOwner,
          trOwner: p.trOwner,
          trId: p.trId,
          ...a,
          unit,
        });
      }
    }
    sentences.sort((x, y) => (x.src === y.src ? 0 : x.src === 'okuma' ? -1 : 1) || x.maxOrder - y.maxOrder || x.en.length - y.en.length);
  } else {
    report.push('! content/tatoeba/en-tr.json yok (npm run import-tatoeba)');
  }

  // ---------- reading texts ----------
  const texts: CourseText[] = [];
  for (let n = 1; n <= units.length; n++) {
    const p = `content/units/unit-${String(n).padStart(2, '0')}.texts.json`;
    if (!exists(p)) continue;
    for (const t of read<TextsFile>(p).texts) {
      const a = analyse(t.sentences.map((s) => s.en).join(' '));
      if (!a) throw new Error(`text ${t.id} uses a word outside the course units`);
      // A text belongs to the unit it was written for (and never before its words).
      texts.push({ ...t, ...a, unit: Math.max(n, unitOf(a.maxOrder)) });
    }
  }

  // ---------- grammar cards ----------
  const grammar: CourseGrammar[] = [];
  if (exists('content/grammar.json')) {
    for (const g of read<{ points: Array<Omit<CourseGrammar, 'order' | 'examples'> & { examples: Array<{ en: string; tr: string }> }> }>(
      'content/grammar.json',
    ).points) {
      if (!position.has(g.word)) continue; // its word is not in a built unit yet
      const examples = g.examples.map((e) => {
        const a = analyse(e.en);
        if (!a) throw new Error(`grammar ${g.id}: example uses a word outside the course units: "${e.en}"`);
        return { ...e, ...a };
      });
      grammar.push({ ...g, order: position.get(g.word)!, examples });
    }
    grammar.sort((a, b) => a.order - b.order);
  }

  const body = { units, order, words, starterKnown: STARTER_KNOWN, forms, sentences, texts, grammar };
  const version = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  const course: Course = {
    version,
    ...body,
    sources: [
      {
        name: 'NGSL 1.2 — Browne, Culligan & Phillips',
        url: 'https://www.newgeneralservicelist.com',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        note: 'Kelime listesi ve sıralaması',
      },
      {
        name: 'Tatoeba',
        url: 'https://tatoeba.org',
        license: 'CC BY 2.0 FR',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
        note: 'İngilizce–Türkçe cümle çiftleri; her cümlenin sahibi Kaynaklar ekranında',
      },
    ],
  };
  return { course, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/build-content.ts')) {
  const { course, report } = buildCourse();
  fs.mkdirSync('content/build', { recursive: true });
  fs.writeFileSync('content/build/course.json', JSON.stringify(course) + '\n');
  for (const r of report) console.log(r);
  const own = course.sentences.filter((s) => s.src === 'okuma').length;
  console.log(
    `✓ course ${course.version}: ${course.order.length} kelime, ${course.sentences.length} cümle (${own} özgün, ${course.sentences.length - own} Tatoeba), ${course.texts.length} metin`,
  );
}
