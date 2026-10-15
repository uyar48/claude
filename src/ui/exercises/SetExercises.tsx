import { useEffect, useMemo, useRef, useState } from 'react';
import { getText, getWord } from '../../content';
import { hashString } from '../../core/session';
import { speaker } from '../../audio/speaker';
import { IconCheck, IconSpeaker } from '../components/Icons';
import { MatchGame, shuffle } from '../components/MatchGame';
import { Picture, useHasPhoto } from '../components/Picture';
import { Reader } from '../components/Reader';
import { Feedback } from './Feedback';
import type { ExerciseProps } from './types';

const firstTry = (words: string[], missed: Iterable<string>) => {
  const m = new Set(missed);
  return Object.fromEntries(words.map((w) => [w, !m.has(w)]));
};

/** Drag words onto pictures; words without a photo are matched to their Turkish meaning. */
export function MatchExercise({ ex, onDone }: ExerciseProps) {
  const hasPhoto = useHasPhoto();
  const words = ex.words!;
  const pictures = words.every((w) => hasPhoto(w));
  return (
    <div className="ex">
      <MatchGame
        wordIds={words}
        onDone={(missed) => onDone({ correct: null, perWord: firstTry(words, missed) })}
        target={pictures ? undefined : (id) => <span className="match-tr">{getWord(id).tr}</span>}
        hint={
          pictures
            ? 'Kelimeyi sürükleyip doğru resmin üstüne bırak. İstersen önce kelimeye, sonra resme dokun.'
            : 'Kelimeyi sürükleyip Türkçesinin üstüne bırak. İstersen önce kelimeye, sonra anlamına dokun.'
        }
      />
    </div>
  );
}

/** Read (and listen to) a short text, then answer its questions. */
export function ReadingExercise({ ex, onDone }: ExerciseProps) {
  const text = getText(ex.textId!);
  const [stage, setStage] = useState<'read' | 'quiz'>('read');
  const [q, setQ] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const tapped = useRef<string[]>([]);

  useEffect(() => () => speaker.stop(), []);

  if (stage === 'read' || text.questions.length === 0) {
    return (
      <div className="ex reading">
        <p className="hint">Oku ve dinle. Bilmediğin kelimeye dokun.</p>
        <Reader textId={text.id} onTapped={(id) => tapped.current.push(id)} />
        <button
          className="btn btn-primary wide big"
          onClick={() => {
            speaker.stop();
            if (text.questions.length) setStage('quiz');
            else onDone({ correct: null, tapped: tapped.current });
          }}
        >
          {text.questions.length ? 'Sorulara geç' : 'Devam'}
        </button>
      </div>
    );
  }

  const question = text.questions[q];
  const correct = picked === question.answer;
  const pictures = question.options.some((o) => o.image);

  function next() {
    const s = score + (correct ? 1 : 0);
    if (q + 1 < text.questions.length) {
      setScore(s);
      setQ(q + 1);
      setPicked(null);
    } else {
      onDone({ correct: null, questions: { correct: s, total: text.questions.length }, tapped: tapped.current });
    }
  }

  return (
    <div className="ex reading-quiz">
      <p className="eyebrow">
        <span lang="en">{text.title}</span> · Soru {q + 1} / {text.questions.length}
      </p>
      <p className="q">{question.prompt}</p>
      <div className={`options ${pictures ? 'options-grid' : 'options-list'}`}>
        {question.options.map((o, i) => {
          const state = picked === null ? '' : i === question.answer ? 'right' : i === picked ? 'wrong' : 'dim';
          return (
            <button
              key={i}
              className={`option ${state}`}
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              lang={o.tr ? 'tr' : 'en'}
            >
              {o.image && getWordSafe(o.image) ? <Picture wordId={o.image} size="sm" /> : <span>{o.en ?? o.tr}</span>}
              {state === 'right' && (
                <span className="badge-ok">
                  <IconCheck />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {picked !== null && <Feedback ok={correct} onNext={next} />}
    </div>
  );
}

function getWordSafe(id: string) {
  try {
    return getWord(id);
  } catch {
    return null;
  }
}

/** Mini scene: objects spread over a "room"; find each one you hear. */
export function Scene({ ex, onDone }: ExerciseProps) {
  const words = ex.words!;
  const order = useMemo(() => shuffle(words, hashString(ex.key)), [words, ex.key]);
  const spots = useMemo(() => shuffle(words, hashString(ex.key) + 1), [words, ex.key]);
  const [i, setI] = useState(0);
  const [found, setFound] = useState<string[]>([]);
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string | null>(null);
  const target = order[i];
  const done = i >= order.length;

  useEffect(() => {
    if (target) void speaker.word(target);
  }, [target]);

  function tap(w: string) {
    if (done || found.includes(w)) return;
    if (w === target) {
      setFound((f) => [...f, w]);
      setTimeout(() => setI((x) => x + 1), 450);
    } else {
      setMissed((m) => new Set(m).add(target));
      setWrong(w);
      setTimeout(() => setWrong(null), 450);
    }
  }

  return (
    <div className="ex scene">
      <p className="hint">Mini sahne: duyduğun şeye dokun.</p>
      {!done ? (
        <div className="scene-ask">
          <span className="en" lang="en">
            Where is the {getWord(target).en}?
          </span>
          <button className="icon-btn" aria-label="Yeniden dinle" onClick={() => speaker.word(target)}>
            <IconSpeaker />
          </button>
        </div>
      ) : (
        <p className="scene-ask">Hepsini buldun.</p>
      )}
      <div className="scene-room">
        {spots.map((w, k) => (
          <button
            key={w}
            className={`scene-item s${k % 6} ${found.includes(w) ? 'found' : ''} ${wrong === w ? 'shake' : ''}`}
            onClick={() => tap(w)}
            aria-label={found.includes(w) ? getWord(w).en : `Nesne ${k + 1}`}
          >
            <Picture wordId={w} size="sm" />
            {found.includes(w) && <span className="match-label">{getWord(w).en}</span>}
          </button>
        ))}
      </div>
      {done && (
        <Feedback
          ok
          auto={false}
          text={missed.size ? `${words.length - missed.size} / ${words.length} ilk denemede.` : 'Hepsi ilk denemede!'}
          onNext={() => onDone({ correct: null, perWord: firstTry(words, missed) })}
        />
      )}
    </div>
  );
}

export const SPEED_MS = 60_000;

/** 60-second round on known words: English word → right Turkish meaning (2 options). */
export function SpeedRound({ ex, onDone }: ExerciseProps) {
  const hasPhoto = useHasPhoto();
  const words = ex.words!;
  const deck = useMemo(() => shuffle(words, hashString(ex.key)), [words, ex.key]);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [n, setN] = useState(0);
  const [right, setRight] = useState(0);
  const [flash, setFlash] = useState<'ok' | 'no' | null>(null);
  const results = useRef<Record<string, boolean>>({});

  const left = started === null ? SPEED_MS : Math.max(0, SPEED_MS - (now - started));
  const over = started !== null && left === 0;

  useEffect(() => {
    if (started === null || over) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [started, over]);

  const w = deck[n % deck.length];
  const other = useMemo(() => {
    for (let k = 0; k < deck.length; k++) {
      const c = deck[(n * 7 + 3 + k) % deck.length];
      if (c !== w && getWord(c).tr !== getWord(w).tr) return c;
    }
    return deck[(n + 1) % deck.length];
  }, [deck, n, w]);
  const leftIsRight = (hashString(`${ex.key}:${n}`) & 1) === 0;
  const opts = leftIsRight ? [w, other] : [other, w];

  function answer(pick: string) {
    if (over) return;
    const ok = pick === w;
    if (!(w in results.current)) results.current[w] = ok;
    if (ok) setRight((r) => r + 1);
    setFlash(ok ? 'ok' : 'no');
    setTimeout(() => setFlash(null), 250);
    setN((x) => x + 1);
  }

  if (started === null) {
    return (
      <div className="ex speed">
        <p className="eyebrow">Hızlı tur · 60 saniye</p>
        <h2>Bildiğin kelimelerle kısa bir tur</h2>
        <p className="muted">İngilizce kelimeyi gör, doğru Türkçesine dokun. Ne kadar çok, o kadar iyi.</p>
        <button
          className="btn btn-primary wide big"
          onClick={() => {
            const t = Date.now();
            setStarted(t);
            setNow(t);
          }}
          autoFocus
        >
          Başla
        </button>
      </div>
    );
  }

  return (
    <div className={`ex speed ${flash ?? ''}`}>
      <div className="speed-bar" aria-hidden>
        <span style={{ width: `${(left / SPEED_MS) * 100}%` }} />
      </div>
      <p className="muted small center">
        {Math.ceil(left / 1000)} sn · {right} doğru
      </p>
      {!over ? (
        <>
          <div className="speed-card">
            {hasPhoto(w) && <Picture wordId={w} size="sm" />}
            <span className="en" lang="en">
              {getWord(w).en}
            </span>
          </div>
          <div className="options options-list two">
            {opts.map((o, i) => (
              <button key={`${n}-${i}`} className="option" onClick={() => answer(o)}>
                {getWord(o).tr}
              </button>
            ))}
          </div>
        </>
      ) : (
        <Feedback
          ok
          auto={false}
          text={`Süre doldu: ${right} doğru cevap!`}
          onNext={() => onDone({ correct: null, perWord: results.current })}
        />
      )}
    </div>
  );
}
