import { useEffect, useRef, useState } from 'react';
import { getText, lookup } from '../../content';
import { speaker } from '../../audio/speaker';
import { tokenize } from '../../core/tokenize';
import { useRuntime } from '../hooks';
import { IconPlay, IconStop } from './Icons';
import { WordSheet } from './WordSheet';

/**
 * Tap-to-read text with read-aloud highlighting.
 * Tapping a unit word opens its picture + meaning and puts it on the review list.
 */
export function Reader({ textId, onTapped }: { textId: string; onTapped?: (wordId: string) => void }) {
  const { store } = useRuntime();
  const text = getText(textId);
  const [playing, setPlaying] = useState(false);
  const [lit, setLit] = useState<{ s: number; w: number | null } | null>(null);
  const [sheet, setSheet] = useState<{ form: string; added: boolean } | null>(null);
  const [showTr, setShowTr] = useState<Set<number>>(new Set());
  const [slow, setSlow] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => () => speaker.stop(), []);

  async function playFrom(start: number, only = false) {
    speaker.unlock();
    speaker.rate = slow ? 0.75 : 1;
    stopRef.current = false;
    setPlaying(true);
    for (let s = start; s < text.sentences.length; s++) {
      if (stopRef.current) break;
      setLit({ s, w: null });
      await speaker.sentence(textId, s, (w) => setLit({ s, w }));
      if (only) break;
      await new Promise((r) => setTimeout(r, 350));
    }
    setLit(null);
    setPlaying(false);
  }

  function stop() {
    stopRef.current = true;
    speaker.stop();
    setPlaying(false);
    setLit(null);
  }

  async function tap(form: string) {
    stop();
    const hit = lookup(form);
    let added = false;
    if (hit.word) {
      await store.tapWord(hit.word.id);
      onTapped?.(hit.word.id);
      added = true;
    }
    setSheet({ form, added });
  }

  return (
    <div className="reader">
      <div className="reader-head">
        <div>
          <h2 className="reader-title">{text.title}</h2>
          <p className="muted small">{text.titleTr}</p>
        </div>
        <div className="row gap-s">
          <button className={`chip ${slow ? 'on' : ''}`} onClick={() => setSlow((x) => !x)} aria-pressed={slow}>
            Yavaş
          </button>
          {playing ? (
            <button className="btn btn-secondary" onClick={stop}>
              <IconStop /> Durdur
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => playFrom(0)}>
              <IconPlay /> Dinle
            </button>
          )}
        </div>
      </div>

      <div className="reader-text" lang="en">
        {text.sentences.map((s, si) => (
          <p key={si} className={`sentence ${lit?.s === si ? 'speaking' : ''}`}>
            <button className="sent-play" aria-label={`Cümle ${si + 1}: dinle`} onClick={() => playFrom(si, true)}>
              <IconPlay />
            </button>
            <span>
              {tokenize(s.en).map((t, ti) =>
                t.norm === null ? (
                  <span key={ti}>{t.text}</span>
                ) : (
                  <button
                    key={ti}
                    className={`w ${lit?.s === si && lit.w === t.wordIndex ? 'lit' : ''}`}
                    onClick={() => tap(t.norm!)}
                  >
                    {t.text}
                  </button>
                ),
              )}
              <button
                className="tr-toggle"
                aria-label="Türkçesini göster"
                onClick={() =>
                  setShowTr((prev) => {
                    const n = new Set(prev);
                    if (n.has(si)) n.delete(si);
                    else n.add(si);
                    return n;
                  })
                }
              >
                TR
              </button>
            </span>
            {showTr.has(si) && <span className="sentence-tr">{s.tr}</span>}
          </p>
        ))}
      </div>

      {sheet && <WordSheet form={sheet.form} added={sheet.added} onClose={() => setSheet(null)} />}
    </div>
  );
}
