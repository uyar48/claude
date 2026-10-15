// One-off: filter the Tatoeba exports into content/tatoeba/en-tr.json.
//
//   TATOEBA_DIR=/path/to/unpacked/exports npm run import-tatoeba
//
// Needs (from https://downloads.tatoeba.org/exports/): user_languages.csv,
// per_language/eng/eng_sentences_detailed.tsv, per_language/tur/tur_sentences_detailed.tsv,
// per_language/eng/eng-tur_links.tsv (decompressed).

import fs from 'node:fs';
import { courseOrder, formIndex, lemmatize, loadNgsl } from './content/lexicon';
import { filterTatoeba } from './content/tatoeba';

/** Keep sentences usable within the first units (course positions). */
const MAX_POSITION = 200;
const MIN_WORDS = 2;
const MAX_WORDS = 8;

const dir = process.env.TATOEBA_DIR;
if (!dir) throw new Error('TATOEBA_DIR is not set');

const lemmas = loadNgsl();
const idx = formIndex(lemmas);
const position = new Map(courseOrder(lemmas).map((w, i) => [w, i]));

const accept = (text: string) => {
  if (!/^[A-Z][^"“”\d]*[.?!]$/.test(text.trim())) return false; // plain sentence, no quotes or digits
  const toks = lemmatize(text, idx);
  if (toks.length < MIN_WORDS || toks.length > MAX_WORDS) return false;
  let names = 0;
  for (const t of toks) {
    if (t === null) return false;
    if (typeof t === 'object') {
      names++;
      continue;
    }
    if ((position.get(t) ?? Infinity) > MAX_POSITION) return false;
  }
  return names <= 1;
};

const pairs = await filterTatoeba({ dir, acceptEnglish: accept });
fs.mkdirSync('content/tatoeba', { recursive: true });
fs.writeFileSync(
  'content/tatoeba/en-tr.json',
  JSON.stringify(
    {
      source: 'Tatoeba (https://tatoeba.org)',
      license: 'CC BY 2.0 FR',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
      exported: new Date().toISOString().slice(0, 10),
      rules: `native owners (eng & tur, level 5); ${MIN_WORDS}-${MAX_WORDS} words; NGSL words within the first ${MAX_POSITION} of the course; at most one name; content filter`,
      pairs,
    },
    null,
    0,
  ) + '\n',
);
console.log(`✓ ${pairs.length} pairs → content/tatoeba/en-tr.json`);
