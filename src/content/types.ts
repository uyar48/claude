// Media types: the audio manifest (src/content/media-manifest.json, written by
// scripts/generate-audio.ts) and the stock-photo credits
// (content/media/credits.json, written by scripts/fetch-images.ts).
// The course itself is typed in courseTypes.ts.

export type Voice = 'female' | 'male';

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

export interface MediaManifest {
  generatedAt?: string;
  ttsProvider?: string;
  /** Keys: `word:<id>:<voice>`, `sent:<textId>:<index>` (reading texts), `s:<sentenceId>` (course sentences). */
  audio: Record<string, AudioAsset>;
}

export const wordAudioKey = (wordId: string, voice: Voice) => `word:${wordId}:${voice}`;
export const sentenceAudioKey = (textId: string, index: number) => `sent:${textId}:${index}`;

// ---------- stock photos (scripts/fetch-images.ts → content/media/credits.json) ----------

export type ImageSource = 'pexels' | 'pixabay' | 'wikimedia' | 'openverse';

export interface ImageCandidate {
  /** File in /media/img/. */
  file: string;
  source: ImageSource;
  /** Page of the photo at the source. */
  url: string;
  title?: string;
  author: string;
  authorUrl?: string;
  license: string;
  licenseUrl?: string;
  /** Original size at the source (the saved file is 800×600). */
  width: number;
  height: number;
  /** Where Openverse found it (flickr, wikimedia …). */
  provider?: string;
}

export interface WordImages {
  /** Index of the candidate used until one is picked on /admin/review. */
  default: number;
  candidates: ImageCandidate[];
  query?: string;
}

export interface ImageCredits {
  generatedAt: string | null;
  /** Free API keys that were not set when the script ran. */
  missingKeys: string[];
  words: Record<string, WordImages>;
}
