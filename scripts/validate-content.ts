// Checks the built course before it ships:
//   npm run validate-content            → report + exit code 1 on errors
//
// • every word: Turkish meaning, kind, ≥ 3 usable sentences in the lesson that
//   teaches it (smallest lesson: 6 new words)
// • concrete words have a photo; abstract/function words an emoji or sentences
// • sentences: source and license fields (Tatoeba owners), only course words
// • texts: ≥ 95 % known words when they unlock, 3–5 valid questions
// • pictures: file present, author and license recorded
// • audio coverage (missing clips fall back to the device voice)
// Writes content/build/validation.md (with a random Tatoeba sample for a
// human check).

import fs from 'node:fs';
import path from 'node:path';
import type { Course } from '../src/content/courseTypes';
import type { ImageCredits, MediaManifest } from '../src/content/types';
import { SENTENCE_COVERAGE, sentenceCoverage } from '../src/core/course';
import { NEW_WORDS_MIN } from '../src/core/progress';

const ROOT = path.resolve(import.meta.dirname, '..');

export interface Finding {
  level: 'error' | 'warning';
  what: string;
}

export interface Report {
  findings: Finding[];
  stats: Record<string, string | number>;
  sample: Array<{ id: string; en: string; tr: string; owners: string }>;
}

const MIN_SENTENCES = 3;

export function validateCourse(
  course: Course,
  credits: ImageCredits,
  media: MediaManifest,
  fileExists: (p: string) => boolean,
  rejectedIds: number[] = [],
): Report {
  const findings: Finding[] = [];
  const err = (what: string) => findings.push({ level: 'error', what });
  const warn = (what: string) => findings.push({ level: 'warning', what });
  const rejected = new Set(rejectedIds);
  const known = (upto: number) => new Set([...course.starterKnown, ...course.order.slice(0, upto + 1)]);

  // ---------- words ----------
  let photo = 0;
  let emojiOnly = 0;
  let sentenceOnly = 0;
  for (const id of course.order) {
    const w = course.words[id];
    if (!w) {
      err(`order lists "${id}" but it has no word entry`);
      continue;
    }
    if (!w.tr?.trim()) err(`${id}: Turkish meaning missing`);
    if (!['concrete', 'abstract', 'function'].includes(w.kind)) err(`${id}: unknown kind "${w.kind}"`);
    // Words are taught in lessons of at least NEW_WORDS_MIN new words, and a
    // lesson may use all of its own new words in its sentences.
    const k = known((Math.floor(w.order / NEW_WORDS_MIN) + 1) * NEW_WORDS_MIN - 1);
    const usable = course.sentences.filter((s) => s.lemmas.includes(id) && s.lemmas.every((l) => k.has(l)));
    if (usable.length < MIN_SENTENCES) err(`${id}: only ${usable.length} sentences usable when it is taught (need ${MIN_SENTENCES})`);
    const pics = credits.words[id]?.candidates ?? [];
    if (pics.length) photo++;
    else if (w.emoji) emojiOnly++;
    else sentenceOnly++;
    if (w.kind === 'concrete' && pics.length === 0) err(`${id}: concrete word without a photo (run npm run fetch-images)`);
    if (w.kind !== 'concrete' && !w.emoji && usable.length < MIN_SENTENCES) err(`${id}: no picture, no emoji and too few sentences`);
  }

  // ---------- sentences ----------
  const ids = new Set<string>();
  let tatoeba = 0;
  for (const s of course.sentences) {
    if (ids.has(s.id)) err(`sentence id ${s.id} is used twice`);
    ids.add(s.id);
    if (!s.en.trim() || !s.tr.trim()) err(`${s.id}: empty text`);
    if (s.src === 'tatoeba') {
      tatoeba++;
      if (!s.enOwner || !s.trOwner || !s.trId) err(`${s.id}: Tatoeba attribution incomplete (owners / Turkish id)`);
      if (rejected.has(Number(s.id.slice(2)))) err(`${s.id}: rejected sentence is still in the course`);
    } else if (s.src !== 'okuma') err(`${s.id}: unknown source "${s.src}"`);
    for (const l of s.lemmas) if (!course.words[l] && !course.starterKnown.includes(l)) err(`${s.id}: uses "${l}", which the course does not teach`);
  }

  // ---------- texts ----------
  for (const t of course.texts) {
    const text = t.sentences.map((s) => s.en).join(' ');
    const cov = sentenceCoverage(course, text, known(t.maxOrder));
    if (cov < SENTENCE_COVERAGE) err(`text ${t.id}: ${(cov * 100).toFixed(0)} % known words when it unlocks (need 95 %)`);
    if (t.questions.length < 3 || t.questions.length > 5) warn(`text ${t.id}: ${t.questions.length} questions (aim for 3–5)`);
    for (const q of t.questions) {
      if (q.answer < 0 || q.answer >= q.options.length) err(`${q.id}: answer index out of range`);
      for (const o of q.options) if (o.image && !course.words[o.image]) err(`${q.id}: picture option "${o.image}" is not a course word`);
    }
  }

  // ---------- pictures ----------
  for (const [id, entry] of Object.entries(credits.words)) {
    entry.candidates.forEach((c, i) => {
      if (!fileExists(`public/media/img/${c.file}`)) err(`${id}: picture ${c.file} missing on disk`);
      if (!c.author || !c.license || !c.url) err(`${id}: candidate ${i + 1} lacks author/license/source link`);
    });
    if (entry.default >= entry.candidates.length) err(`${id}: default candidate out of range`);
  }

  // ---------- audio ----------
  const has = (k: string) => Boolean(media.audio[k]);
  const wordAudio = course.order.filter((id) => has(`word:${id}:female`) || has(`word:${id}:male`)).length;
  const textSent = course.texts.flatMap((t) => t.sentences.map((_, i) => `sent:${t.id}:${i}`));
  const textAudio = textSent.filter(has).length;
  const sentAudio = course.sentences.filter((s) => has(`s:${s.id}`)).length;
  for (const [k, a] of Object.entries(media.audio)) if (!fileExists(`public/media/audio/${a.file}`)) err(`audio ${k}: file ${a.file} missing`);
  if (wordAudio < course.order.length) warn(`${course.order.length - wordAudio} words without a recorded clip (device voice is used)`);
  if (sentAudio < course.sentences.length) warn(`${course.sentences.length - sentAudio} sentences without a recorded clip (device voice is used)`);

  // ---------- sample for a human check ----------
  const tat = course.sentences.filter((s) => s.src === 'tatoeba');
  const stride = Math.max(1, Math.floor(tat.length / 20));
  const sample = Array.from({ length: Math.min(20, tat.length) }, (_, i) => tat[(i * stride + 3) % tat.length]).map((s) => ({
    id: s.id,
    en: s.en,
    tr: s.tr,
    owners: `${s.enOwner} / ${s.trOwner}`,
  }));

  return {
    findings,
    sample,
    stats: {
      course: course.version,
      words: course.order.length,
      'words with photo': photo,
      'words with emoji only': emojiOnly,
      'words taught with sentence + audio only': sentenceOnly,
      sentences: course.sentences.length,
      'Tatoeba sentences': tatoeba,
      'own sentences': course.sentences.length - tatoeba,
      texts: course.texts.length,
      'word clips': `${wordAudio} / ${course.order.length}`,
      'text sentence clips': `${textAudio} / ${textSent.length}`,
      'course sentence clips': `${sentAudio} / ${course.sentences.length}`,
    },
  };
}

export function toMarkdown(r: Report): string {
  const errors = r.findings.filter((f) => f.level === 'error');
  const warnings = r.findings.filter((f) => f.level === 'warning');
  return [
    '# Content validation',
    '',
    errors.length ? `**${errors.length} errors**` : '**No errors.**',
    '',
    '| | |',
    '|---|---|',
    ...Object.entries(r.stats).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(errors.length ? ['## Errors', '', ...errors.map((e) => `- ${e.what}`), ''] : []),
    ...(warnings.length ? ['## Warnings', '', ...warnings.map((e) => `- ${e.what}`), ''] : []),
    '## Tatoeba sample for a human check',
    '',
    '| id | English | Türkçe | owners |',
    '|---|---|---|---|',
    ...r.sample.map((s) => `| ${s.id} | ${s.en} | ${s.tr} | ${s.owners} |`),
    '',
  ].join('\n');
}

function main() {
  const read = <T,>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as T;
  const course = read<Course>('content/build/course.json');
  const credits = read<ImageCredits>('content/media/credits.json');
  const media = read<MediaManifest>('src/content/media-manifest.json');
  const rejected = read<{ ids: number[] }>('content/tatoeba/rejected.json').ids;
  const report = validateCourse(course, credits, media, (p) => fs.existsSync(path.join(ROOT, p)), rejected);
  const md = toMarkdown(report);
  fs.writeFileSync(path.join(ROOT, 'content/build/validation.md'), md);
  for (const [k, v] of Object.entries(report.stats)) console.log(`${k.padEnd(40)} ${v}`);
  for (const f of report.findings) console.log(`${f.level === 'error' ? '✗' : '!'} ${f.what}`);
  const errors = report.findings.filter((f) => f.level === 'error').length;
  console.log(errors ? `\n${errors} errors — see content/build/validation.md` : '\nNo errors — report: content/build/validation.md');
  process.exit(errors ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
