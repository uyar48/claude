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
import type { Course, CourseSentence, CourseText, CourseWord, WordKind } from '../src/content/courseTypes';
import { courseOrder, formIndex, lemmatize, loadNgsl, STARTER_KNOWN, UNIT_SIZE } from './content/lexicon';

/** At most this many Tatoeba sentences per word (the newest word in the sentence). */
const TATOEBA_PER_WORD = 12;

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
        en: w.id === 'i' ? 'I' : w.id,
        tr: w.tr,
        pos: w.pos,
        kind: w.kind,
        ...(w.emoji ? { emoji: w.emoji } : {}),
        ...(w.query ? { query: w.query } : {}),
        rank: rank.get(w.id) ?? null,
        order: fullOrder.indexOf(w.id),
        unit: n,
      };
    }
    units.push({ n, title: file.title, titleTr: file.titleTr, words: expected });
  }
  const order = fullOrder.filter((w) => words[w]);
  const position = new Map(order.map((w, i) => [w, i]));

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
      sentences.push({ id: `o:${n}-${i + 1}`, en: s.en, tr: s.tr, src: 'okuma', ...a });
    });
  }

  if (exists('content/tatoeba/en-tr.json')) {
    const perWord = new Map<string, number>();
    const pairs = read<TatoebaFile>('content/tatoeba/en-tr.json').pairs
      .map((p) => ({ p, a: analyse(p.en) }))
      .filter((x): x is { p: TatoebaFile['pairs'][number]; a: { lemmas: string[]; maxOrder: number } } => x.a !== null && !REJECTED.has(x.p.enId))
      // Shorter sentences first; "Tom" sentences after the others.
      .sort((x, y) => x.p.en.length - y.p.en.length || Number(/Tom\b/.test(x.p.en)) - Number(/Tom\b/.test(y.p.en)) || x.p.enId - y.p.enId);
    for (const { p, a } of pairs) {
      if (seen.has(key(p.en))) continue;
      const newest = a.maxOrder < 0 ? 'starter' : order[a.maxOrder];
      if ((perWord.get(newest) ?? 0) >= TATOEBA_PER_WORD) continue;
      perWord.set(newest, (perWord.get(newest) ?? 0) + 1);
      seen.add(key(p.en));
      sentences.push({
        id: `t:${p.enId}`,
        en: p.en,
        tr: p.tr,
        src: 'tatoeba',
        enOwner: p.enOwner,
        trOwner: p.trOwner,
        trId: p.trId,
        ...a,
      });
    }
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
      texts.push({ ...t, ...a });
    }
  }

  const body = { units, order, words, starterKnown: STARTER_KNOWN, forms, sentences, texts };
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
