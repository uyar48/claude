import { useEffect, useMemo, useRef, useState } from 'react';
import { course, getSentence, getWord } from '../../content';
import { checkSentence, dictationVerdict, revealSentence, wordsToType, type SentenceCheck } from '../../core/answer';
import { sentenceTokens } from '../../core/course';
import { hashString } from '../../core/session';
import { speaker } from '../../audio/speaker';
import { IconPlay, IconSpeaker } from '../components/Icons';
import { shuffle } from '../components/MatchGame';
import { Feedback } from './Feedback';
import type { ExerciseProps } from './types';

const inputProps = {
  lang: 'en',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  autoComplete: 'off',
  spellCheck: false,
  enterKeyHint: 'done',
} as const;

/** The reference sentence with the words that differed marked. */
function MarkedSentence({ check, sentenceId }: { check: SentenceCheck; sentenceId: string }) {
  return (
    <p className="correct-line marked" lang="en">
      <button className="sent-play" aria-label="Doğru cümleyi dinle" onClick={() => speaker.courseSentence(sentenceId)}>
        <IconPlay />
      </button>
      <span>
        {check.marks.map((m, i) => (
          <span key={i}>
            {i > 0 && ' '}
            <span className={`mk ${m.mark}`}>{m.word}</span>
          </span>
        ))}
      </span>
    </p>
  );
}

/** Type the missing word of a real sentence; the Turkish meaning is shown. Two tries. */
export function TypeBlank({ ex, onDone }: ExerciseProps) {
  const sent = getSentence(ex.sentenceId!);
  const word = getWord(ex.wordId!);
  const tokens = useMemo(() => sentenceTokens(course, sent.en), [sent.en]);
  const gap = tokens[ex.gapIndex!];
  const [value, setValue] = useState('');
  const [tries, setTries] = useState(0);
  const [verdict, setVerdict] = useState<'right' | 'close' | 'wrong' | null>(null);
  const [finished, setFinished] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function finish(v: 'right' | 'close' | 'wrong') {
    setVerdict(v);
    setFinished(true);
    void speaker.courseSentence(sent.id);
  }

  function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (finished || !value.trim()) return;
    const v = dictationVerdict(value, gap.text);
    const n = tries + 1;
    setTries(n);
    if (v !== 'wrong' || n >= 2) finish(v);
    else {
      setVerdict(v);
      setValue('');
      input.current?.focus();
    }
  }

  const otherForm = gap.text.toLowerCase() !== word.en.toLowerCase();

  return (
    <div className="ex type-blank">
      <p className="hint">Boşluğa gelen kelimeyi yaz.</p>
      <p className="blank-sentence" lang="en">
        {tokens.map((t, i) =>
          i === ex.gapIndex ? (
            <span key={i} className={`gap ${finished ? 'filled' : ''}`}>
              {finished ? t.text : ' '}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </p>
      <p className="muted center">{sent.tr}</p>
      <p className="muted small center">
        {gap.text.length} harf
        {tries >= 1 && !finished && ` · "${gap.text[0]}" ile başlıyor${otherForm ? ` · ${word.en} kelimesinin bir hâli` : ''}`}
      </p>
      <form onSubmit={check} className="dictation-form">
        <input
          ref={input}
          className="dictation-input"
          {...inputProps}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Boşluktaki kelime"
          disabled={finished}
          autoFocus
        />
        {!finished && (
          <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
            Kontrol et
          </button>
        )}
      </form>
      {!finished && tries === 1 && <p className="note">Bir daha dene.</p>}
      {!finished && (
        <button className="link small" onClick={() => (setTries(2), finish('wrong'))}>
          Bilmiyorum, göster
        </button>
      )}
      {finished && (
        <Feedback
          ok={verdict !== 'wrong'}
          auto={verdict === 'right'}
          text={
            verdict === 'right'
              ? 'Doğru.'
              : verdict === 'close'
                ? `Neredeyse — doğrusu: ${gap.text}`
                : `Doğrusu: ${gap.text} (${word.tr})`
          }
          onNext={() => onDone({ correct: verdict !== 'wrong' && tries === 1 })}
        />
      )}
    </div>
  );
}

/** Listen to a short sentence and write it. */
export function SentenceDictation({ ex, onDone }: ExerciseProps) {
  const sent = getSentence(ex.sentenceId!);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<SentenceCheck | null>(null);

  useEffect(() => {
    void speaker.courseSentence(sent.id);
    return () => speaker.stop();
  }, [sent.id]);

  function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (result || !value.trim()) return;
    setResult(checkSentence(value, sent.en));
  }

  const ok = result !== null && result.verdict !== 'wrong';
  return (
    <div className="ex dictate">
      <p className="hint">Dinle ve cümleyi yaz.</p>
      <div className="row center gap">
        <button className="big-listen" aria-label="Yeniden dinle" onClick={() => speaker.courseSentence(sent.id)}>
          <IconSpeaker />
        </button>
      </div>
      <p className="muted small center">{wordsToType(sent.en)} kelime</p>
      <form onSubmit={check} className="dictation-form">
        <input
          className="dictation-input sentence-input"
          {...inputProps}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Duyduğun cümle"
          disabled={result !== null}
          autoFocus
        />
        {!result && (
          <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
            Kontrol et
          </button>
        )}
      </form>
      {!result && (
        <button className="link small" onClick={() => setResult(revealSentence(sent.en))}>
          Bilmiyorum, göster
        </button>
      )}
      {result && (
        <>
          <MarkedSentence check={result} sentenceId={sent.id} />
          <p className="muted center">{sent.tr}</p>
          <Feedback
            ok={ok}
            auto={result.verdict === 'right'}
            text={result.verdict === 'right' ? 'Doğru.' : result.verdict === 'close' ? 'Küçük yazım hatası, doğru sayıldı.' : value.trim() ? 'Farklı yerler işaretli.' : 'Doğrusu yukarıda.'}
            onNext={() => onDone({ correct: ok })}
          />
        </>
      )}
    </div>
  );
}

/** Write the English of a Turkish sentence. A hint shows the words (mixed up). */
export function WriteSentence({ ex, onDone }: ExerciseProps) {
  const sent = getSentence(ex.sentenceId!);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(false);
  const [result, setResult] = useState<SentenceCheck | null>(null);
  const [accepted, setAccepted] = useState(false);
  const words = useMemo(
    () => shuffle(sent.en.replace(/[.?!,]+$/g, '').split(/\s+/).map((w) => w.replace(/[.?!,;:]+$/, '')), hashString(ex.key)),
    [sent.en, ex.key],
  );

  useEffect(() => () => speaker.stop(), []);

  function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (result || !value.trim()) return;
    setResult(checkSentence(value, sent.en, { fromTurkish: true }));
    void speaker.courseSentence(sent.id);
  }

  const ok = accepted || (result !== null && result.verdict !== 'wrong');
  return (
    <div className="ex write">
      <p className="hint">Bu cümleyi İngilizce yaz.</p>
      <p className="prompt-tr">{sent.tr}</p>
      <p className="muted small center">
        {wordsToType(sent.en)} kelime
        {!hint && !result && (
          <>
            {' · '}
            <button className="link small" onClick={() => setHint(true)}>
              İpucu
            </button>
          </>
        )}
      </p>
      {hint && (
        <p className="hint-words" lang="en">
          {words.map((w, i) => (
            <span key={i} className="tile">
              {w}
            </span>
          ))}
        </p>
      )}
      <form onSubmit={check} className="dictation-form">
        <input
          className="dictation-input sentence-input"
          {...inputProps}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="İngilizcesi"
          disabled={result !== null}
          autoFocus
        />
        {!result && (
          <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
            Kontrol et
          </button>
        )}
      </form>
      {!result && (
        <button className="link small" onClick={() => setResult(revealSentence(sent.en))}>
          Bilmiyorum, göster
        </button>
      )}
      {result && (
        <>
          <MarkedSentence check={result} sentenceId={sent.id} />
          <Feedback
            ok={ok}
            auto={result.verdict === 'right'}
            text={
              accepted
                ? 'Tamam, doğru sayıldı.'
                : result.verdict === 'right'
                  ? 'Doğru.'
                  : result.verdict === 'close'
                    ? 'Küçük yazım hatası, doğru sayıldı.'
                    : value.trim()
                      ? 'Farklı yerler işaretli.'
                      : 'Doğrusu yukarıda.'
            }
            extra={
              !ok && value.trim() ? (
                <button className="btn btn-secondary" onClick={() => setAccepted(true)}>
                  Benimki de doğru
                </button>
              ) : null
            }
            onNext={() => onDone({ correct: ok })}
          />
        </>
      )}
    </div>
  );
}
