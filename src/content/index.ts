import unit1 from '../../content/level0/unit1.json';
import manifestJson from './media-manifest.json';
import type { MediaManifest, UnitContent, Word } from './types';

export const content = unit1 as UnitContent;
export const media = manifestJson as MediaManifest;

const wordById = new Map(content.words.map((w) => [w.id, w]));
const wordByForm = new Map(content.words.map((w) => [w.en.toLowerCase(), w]));
const functionByForm = new Map(content.functionWords.map((f) => [f.en.toLowerCase(), f]));

export function getWord(id: string): Word {
  const w = wordById.get(id);
  if (!w) throw new Error(`Unknown word ${id}`);
  return w;
}

export function getText(id: string) {
  const t = content.texts.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown text ${id}`);
  return t;
}

/** Looks up a running-text word form: unit word or function word. */
export function lookup(form: string): { word?: Word; gloss?: string } {
  const f = form.toLowerCase();
  const word = wordByForm.get(f);
  if (word) return { word };
  const fn = functionByForm.get(f);
  if (fn) return { gloss: fn.tr };
  return {};
}
