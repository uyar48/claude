// Filters the Tatoeba exports into short English–Turkish pairs we can use.
//
// Rules (brief v2): only sentences whose owner declared the language as native
// (skill level 5) — for both the English and the Turkish side; short; no
// coarse or violent vocabulary; every English word is an NGSL word or a name.
// License: CC BY 2.0 FR — each sentence keeps its id and owner for credits.

import fs from 'node:fs';
import readline from 'node:readline';

export interface TatoebaPair {
  enId: number;
  trId: number;
  en: string;
  tr: string;
  enOwner: string;
  trOwner: string;
}

const BLOCK_EN =
  /\b(kill\w*|die|died|dies|dying|dead|death|murder\w*|suicide|gun|guns|shoot\w*|bomb\w*|war|wars|blood\w*|sex\w*|naked|nude|drunk|drugs?|beer|wine|vodka|whisky|whiskey|hate[sd]?|stupid|idiot\w*|fool\w*|damn\w*|hell|fuck\w*|shit\w*|bitch\w*|ass|bastard\w*|rape\w*|prison|jail|crime|criminal|steal\w*|stole\w*|thief|cancer|sick|ill|hospital|funeral|grave|weapon\w*|knife|knives|ugly|fat|dumb|crazy|shut up)\b/i;
const BLOCK_TR = /(öl[düe]|öldür|ölüm|silah|seks|çıplak|sarhoş|uyuşturucu|bira|şarap|aptal|salak|ahmak|lanet|kahrolsun|siktir|bok|orospu|hapis|hapishane|hırsız|kanser|cenaze|bıçak|çirkin|şişman|deli)/i;

async function* lines(file: string) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

export async function nativeSpeakers(userLanguagesCsv: string): Promise<Record<'eng' | 'tur', Set<string>>> {
  const out = { eng: new Set<string>(), tur: new Set<string>() };
  for await (const line of lines(userLanguagesCsv)) {
    const [lang, level, user] = line.split('\t');
    if ((lang === 'eng' || lang === 'tur') && level === '5' && user) out[lang].add(user);
  }
  return out;
}

async function sentences(file: string, owners: Set<string>, keep: (text: string) => boolean) {
  const out = new Map<number, { text: string; owner: string }>();
  for await (const line of lines(file)) {
    const [id, , text, owner] = line.split('\t');
    if (!owner || owner === '\\N' || !owners.has(owner) || !keep(text)) continue;
    out.set(Number(id), { text, owner });
  }
  return out;
}

export async function filterTatoeba(opts: {
  dir: string;
  acceptEnglish: (text: string) => boolean;
  maxTrChars?: number;
}): Promise<TatoebaPair[]> {
  const natives = await nativeSpeakers(`${opts.dir}/user_languages.csv`);
  const en = await sentences(`${opts.dir}/eng_sentences_detailed.tsv`, natives.eng, (t) => !BLOCK_EN.test(t) && opts.acceptEnglish(t));
  const tr = await sentences(
    `${opts.dir}/tur_sentences_detailed.tsv`,
    natives.tur,
    (t) => t.length <= (opts.maxTrChars ?? 90) && !BLOCK_TR.test(t),
  );
  const byEn = new Map<number, TatoebaPair>();
  for await (const line of lines(`${opts.dir}/eng-tur_links.tsv`)) {
    const [a, b] = line.split('\t').map(Number);
    const e = en.get(a);
    const t = tr.get(b);
    if (!e || !t) continue;
    const prev = byEn.get(a);
    // One translation per English sentence: the shortest native one.
    if (!prev || t.text.length < prev.tr.length) {
      byEn.set(a, { enId: a, trId: b, en: e.text, tr: t.text, enOwner: e.owner, trOwner: t.owner });
    }
  }
  // Drop duplicate English texts (keep the lowest id).
  const seen = new Set<string>();
  return [...byEn.values()]
    .sort((x, y) => x.enId - y.enId)
    .filter((p) => {
      const k = p.en.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
