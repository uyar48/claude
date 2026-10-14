import { useState } from 'react';
import { getText } from '../../content';
import { FillBlank } from '../components/FillBlank';
import { Reader } from '../components/Reader';

export interface ReadingResult {
  textIds: string[];
  tapped: string[];
  blanksFirstTry: number;
  blanksTotal: number;
}

/** Listen + tap-to-read the text, then its fill-in-the-blank exercises. Optional second text. */
export function ReadingStep({
  textId,
  extraTextIds,
  onDone,
}: {
  textId: string;
  extraTextIds: string[];
  onDone: (r: ReadingResult) => void;
}) {
  const [current, setCurrent] = useState(textId);
  const [phase, setPhase] = useState<'read' | 'blanks' | 'offer'>('read');
  const [b, setB] = useState(0);
  const [result, setResult] = useState<ReadingResult>({ textIds: [], tapped: [], blanksFirstTry: 0, blanksTotal: 0 });
  const text = getText(current);
  const extra = extraTextIds.find((id) => !result.textIds.includes(id) && id !== current);

  function blankDone(firstTry: boolean) {
    const r = { ...result, blanksFirstTry: result.blanksFirstTry + (firstTry ? 1 : 0), blanksTotal: result.blanksTotal + 1 };
    if (b + 1 < text.blanks.length) {
      setResult(r);
      setB(b + 1);
      return;
    }
    const finished = { ...r, textIds: [...r.textIds, current] };
    setResult(finished);
    if (extra) setPhase('offer');
    else onDone(finished);
  }

  if (phase === 'offer' && extra) {
    return (
      <div className="step">
        <div className="panel">
          <h3>Bir metin daha?</h3>
          <p className="muted">
            Bildiğin kelimelerle okunabilen bir metin daha var: <strong lang="en">{getText(extra).title}</strong>.
          </p>
          <div className="row gap">
            <button className="btn btn-secondary grow" onClick={() => onDone(result)}>
              Sınava geç
            </button>
            <button
              className="btn btn-primary grow"
              onClick={() => {
                setCurrent(extra);
                setB(0);
                setPhase('read');
              }}
            >
              Oku
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'blanks') {
    return (
      <div className="step">
        <p className="step-count">
          Boşluk doldurma {b + 1} / {text.blanks.length}
        </p>
        <FillBlank key={`${current}-${b}`} blank={text.blanks[b]} textId={current} onDone={blankDone} />
      </div>
    );
  }

  return (
    <div className="step">
      <p className="hint">Önce dinle ve takip et. Sonra kendin oku. Bilmediğin kelimeye dokun.</p>
      <Reader
        key={current}
        textId={current}
        onTapped={(id) => setResult((r) => (r.tapped.includes(id) ? r : { ...r, tapped: [...r.tapped, id] }))}
      />
      <button className="btn btn-primary wide" onClick={() => setPhase('blanks')}>
        Okudum, devam
      </button>
    </div>
  );
}
