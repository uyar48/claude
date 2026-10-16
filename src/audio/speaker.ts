// Audio playback with word highlighting. Uses generated clips when present,
// otherwise the browser's speechSynthesis (no API key needed).
//
// iOS only allows audio started from a user gesture, so a single <audio>
// element is unlocked on the first tap and reused for every clip.

import { getSentence, getText, getWord } from '../content';
import { phraseAudio, sentenceAudio, textSentenceAudio, wordAudio } from '../content/media';
import type { Voice } from '../content/types';
import { estimateTimings, wordAt } from '../core/timing';
import { tokenize } from '../core/tokenize';

type OnWord = (wordIndex: number | null) => void;

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

class Speaker {
  private el: HTMLAudioElement | null = null;
  private raf = 0;
  private cancelCurrent: (() => void) | null = null;
  rate = 1;

  private audio(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
      this.el.setAttribute('playsinline', '');
    }
    return this.el;
  }

  /** Call from a click/tap handler before the first playback. */
  unlock() {
    const a = this.audio();
    if (a.dataset.unlocked) return;
    a.dataset.unlocked = '1';
    a.src = SILENT_WAV;
    a.play().catch(() => {});
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  stop() {
    this.cancelCurrent?.();
    this.cancelCurrent = null;
    cancelAnimationFrame(this.raf);
    if (this.el) this.el.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async word(wordId: string, voice: Voice = 'female') {
    const clip = wordAudio(wordId, voice);
    if (clip) return this.playFile(clip.url, null, null);
    return this.speak(getWord(wordId).en, voice, null);
  }

  /** A course sentence (Tatoeba or own) by id. */
  async courseSentence(sentenceId: string, onWord: OnWord | null = null) {
    const s = getSentence(sentenceId);
    const clip = sentenceAudio(sentenceId);
    if (clip) return this.playFile(clip.url, clip.timings ?? null, onWord ? { text: s.en, onWord } : null);
    return this.speak(s.en, 'female', onWord);
  }

  /** A recorded phrase by manifest key (e.g. a grammar example), else the device voice. */
  async phrase(key: string, text: string) {
    const clip = phraseAudio(key);
    if (clip) return this.playFile(clip.url, null, null);
    return this.speak(text, 'female', null);
  }

  async text(text: string, voice: Voice = 'female') {
    return this.speak(text, voice, null);
  }

  /** Plays one sentence of a text, reporting the word being spoken. */
  async sentence(textId: string, index: number, onWord: OnWord) {
    const t = getText(textId);
    const s = t.sentences[index].en;
    const clip = textSentenceAudio(textId, index);
    if (clip) return this.playFile(clip.url, clip.timings ?? null, { text: s, onWord });
    return this.speak(s, t.voice, onWord);
  }

  private playFile(url: string, timings: { i: number; start: number; end: number }[] | null, hl: { text: string; onWord: OnWord } | null) {
    this.stop();
    const a = this.audio();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(this.raf);
        hl?.onWord(null);
        a.onended = a.onerror = null;
        resolve();
      };
      this.cancelCurrent = finish;
      a.onended = finish;
      a.onerror = finish;
      a.src = url;
      a.playbackRate = this.rate;
      a.play().catch(finish);
      if (hl) {
        let tm = timings;
        const tick = () => {
          if (!tm && Number.isFinite(a.duration) && a.duration > 0) tm = estimateTimings(hl.text, a.duration);
          hl.onWord(tm ? wordAt(tm, a.currentTime) : null);
          if (!done) this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      }
    });
  }

  private speak(text: string, voice: Voice, onWord: OnWord | null) {
    this.stop();
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9 * this.rate;
      const v = pickVoice(voice);
      if (v) u.voice = v;

      // Map character offsets to word indexes for boundary events.
      const starts: Array<{ at: number; i: number }> = [];
      let pos = 0;
      for (const t of tokenize(text)) {
        if (t.wordIndex !== null) starts.push({ at: pos, i: t.wordIndex });
        pos += t.text.length;
      }
      let gotBoundary = false;
      let fallback: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (fallback) clearTimeout(fallback);
        cancelAnimationFrame(this.raf);
        onWord?.(null);
        resolve();
      };
      this.cancelCurrent = () => {
        finish();
      };
      u.onboundary = (e) => {
        if (!onWord || e.name === 'sentence') return;
        gotBoundary = true;
        const hit = [...starts].reverse().find((s) => s.at <= e.charIndex);
        onWord(hit ? hit.i : null);
      };
      u.onstart = () => {
        if (!onWord) return;
        // Some engines (notably iOS) send no word boundaries: estimate instead.
        fallback = setTimeout(() => {
          if (gotBoundary) return;
          const duration = (text.length * 0.07 + 0.3) / u.rate;
          const tm = estimateTimings(text, duration, 0);
          const t0 = performance.now() - 250;
          const tick = () => {
            if (done) return;
            onWord(wordAt(tm, (performance.now() - t0) / 1000));
            this.raf = requestAnimationFrame(tick);
          };
          tick();
        }, 250);
      };
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }
}

const FEMALE = /samantha|allison|ava|susan|zira|victoria|karen|serena|jenny|aria|female|google us english/i;
const MALE = /\b(alex|aaron|fred|tom|david|guy|daniel|evan|nathan|male)\b/i;

function pickVoice(voice: Voice): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const all = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('en-US'));
  if (!all.length) return null;
  const re = voice === 'female' ? FEMALE : MALE;
  return all.find((v) => re.test(v.name) && !(voice === 'female' ? MALE : FEMALE).test(v.name)) ?? all[0];
}

export const speaker = new Speaker();
