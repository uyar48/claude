// Content schema: Level → Unit → Word / Text → Question.
// Media (image/audio) is attached separately through the media manifest so the
// content files stay hand-editable.

export interface Level {
  id: string;
  order: number;
  title: string;
  description?: string;
}

export interface Unit {
  id: string;
  levelId: string;
  order: number;
  title: string;
  titleEn: string;
  /** Shared style suffix appended to every image prompt of the unit. */
  imageStyle: string;
}

export interface FunctionWord {
  en: string;
  tr: string;
}

export interface Word {
  id: string;
  en: string;
  tr: string;
  pos: string;
  /** Introduction group inside the unit (1 = first lesson day). */
  day: number;
  example: string;
  exampleTr: string;
  imagePrompt: string;
}

export interface Sentence {
  en: string;
  tr: string;
}

export interface QuestionOption {
  en?: string;
  /** Word id whose picture is the option. */
  image?: string;
}

export interface Question {
  id: string;
  /** Turkish question text. */
  prompt: string;
  options: QuestionOption[];
  answer: number;
}

export interface Blank {
  id: string;
  /** Sentence with a single "___" gap. */
  sentence: string;
  options: string[];
  answer: number;
}

export interface Text {
  id: string;
  order: number;
  main?: boolean;
  title: string;
  titleTr: string;
  voice: Voice;
  sentences: Sentence[];
  questions: Question[];
  blanks: Blank[];
}

export type Voice = 'female' | 'male';

export interface UnitContent {
  level: Level;
  unit: Unit;
  functionWords: FunctionWord[];
  words: Word[];
  texts: Text[];
}

// ---------- media manifest ----------

export interface WordTiming {
  /** Index of the word token inside the sentence (see tokenize). */
  i: number;
  start: number;
  end: number;
}

export interface AudioAsset {
  file: string;
  provider: string;
  model?: string;
  voice?: string;
  hash: string;
  duration?: number;
  /** Per-word timings in seconds; source tells how they were obtained. */
  timings?: WordTiming[];
  timingSource?: 'provider' | 'alignment' | 'estimate';
  /** Bumped when the user asks to regenerate (changes the hash). */
  variant?: number;
}

export interface ImageAsset {
  file: string;
  provider: string;
  model?: string;
  hash: string;
  placeholder?: boolean;
  variant?: number;
}

export interface MediaManifest {
  generatedAt?: string;
  imageProvider?: string;
  ttsProvider?: string;
  missingKeys?: string[];
  images: Record<string, ImageAsset>;
  /** Keys: `word:<id>:<voice>`, `ex:<id>` (example sentence) and `sent:<textId>:<index>`. */
  audio: Record<string, AudioAsset>;
  /** Optional side-by-side comparison sets for /admin/review. */
  compare?: {
    images?: Record<string, Record<string, ImageAsset>>;
    audio?: Record<string, Record<string, AudioAsset>>;
  };
}

export const wordAudioKey = (wordId: string, voice: Voice) => `word:${wordId}:${voice}`;
export const exampleAudioKey = (wordId: string) => `ex:${wordId}`;
export const sentenceAudioKey = (textId: string, index: number) => `sent:${textId}:${index}`;
