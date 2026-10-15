// Course data (built by scripts/build-content.ts into content/build/course.json).

export type WordKind = 'concrete' | 'abstract' | 'function';

export interface CourseWord {
  id: string;
  /** Display form (e.g. "I" for the lemma "i"). */
  en: string;
  tr: string;
  pos: string;
  kind: WordKind;
  emoji?: string;
  /** Stock-photo search query for concrete words. */
  query?: string;
  /** NGSL 1.2 frequency rank (null for words outside NGSL). */
  rank: number | null;
  /** Position in the course order (0-based). */
  order: number;
  unit: number;
}

export interface CourseSentence {
  /** "t:<tatoebaId>" or "o:<n>" (own). */
  id: string;
  en: string;
  tr: string;
  src: 'tatoeba' | 'okuma';
  /** Tatoeba owners and ids for attribution (CC BY 2.0 FR). */
  enOwner?: string;
  trOwner?: string;
  trId?: number;
  /** Distinct lemmas used (names excluded). */
  lemmas: string[];
  /** Highest course position among its lemmas: usable once that word is introduced. */
  maxOrder: number;
}

export interface CourseQuestion {
  id: string;
  prompt: string;
  options: Array<{ en?: string; image?: string; tr?: string }>;
  answer: number;
}

export interface CourseText {
  id: string;
  title: string;
  titleTr: string;
  voice: 'female' | 'male';
  sentences: Array<{ en: string; tr: string }>;
  questions: CourseQuestion[];
  lemmas: string[];
  maxOrder: number;
}

export interface CourseUnit {
  n: number;
  title: string;
  titleTr: string;
  words: string[];
}

export interface Course {
  version: string;
  units: CourseUnit[];
  /** Word ids in teaching order (only words with content). */
  order: string[];
  words: Record<string, CourseWord>;
  /** Lemmas counted as known from the start for coverage (met with glosses since lesson 1). */
  starterKnown: string[];
  /** Word form → lemma for the course words (tap-to-read, coverage). */
  forms: Record<string, string>;
  sentences: CourseSentence[];
  texts: CourseText[];
  sources: Array<{ name: string; url: string; license: string; licenseUrl: string; note?: string }>;
}
