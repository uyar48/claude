import { useMemo, useRef, useState, type ReactNode } from 'react';
import { getWord } from '../../content';
import { speaker } from '../../audio/speaker';
import { Picture } from './Picture';

/**
 * Drag each English word onto its picture (or its Turkish meaning). Works with
 * touch, mouse and pen (Pointer Events — HTML5 drag-and-drop does not work on
 * iPhone). Tapping a word and then a target does the same thing.
 * Reports the words that were dropped on a wrong target at least once.
 */
export function MatchGame({
  wordIds,
  onDone,
  target = (id) => <Picture wordId={id} size="sm" />,
  hint = 'Kelimeyi sürükleyip doğru resmin üstüne bırak. İstersen önce kelimeye, sonra resme dokun.',
}: {
  wordIds: string[];
  onDone: (missed: string[]) => void;
  target?: (wordId: string) => ReactNode;
  hint?: string;
}) {
  const pictures = useMemo(() => shuffle(wordIds, wordIds.join().length + 7), [wordIds]);
  const chips = useMemo(() => shuffle(wordIds, wordIds.join().length + 3), [wordIds]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const moved = useRef(false);

  function attempt(wordId: string, target: string) {
    if (wordId === target) {
      const next = new Set(matched).add(wordId);
      setMatched(next);
      setSelected(null);
      void speaker.word(wordId);
      if (next.size === wordIds.length) setTimeout(() => onDone([...missed]), 600);
    } else {
      setMissed((m) => new Set(m).add(wordId));
      setWrong(target);
      setTimeout(() => setWrong(null), 450);
    }
  }

  function targetAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest('[data-target]') as HTMLElement | null;
    return el?.dataset.target ?? null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (matched.has(id)) return;
    speaker.unlock();
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = false;
    setDrag({ id, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) moved.current = true;
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
    setHover(targetAt(e.clientX, e.clientY));
  }

  function onPointerUp(e: React.PointerEvent, id: string) {
    const d = drag;
    setDrag(null);
    setHover(null);
    if (!d) return;
    if (moved.current) {
      const t = targetAt(e.clientX, e.clientY);
      if (t) attempt(id, t);
    } else {
      // a tap: select the word, or play it
      setSelected((s) => (s === id ? null : id));
      void speaker.word(id);
    }
  }

  return (
    <div className="match" onPointerMove={onPointerMove}>
      <p className="hint">{hint}</p>
      <div className="match-chips">
        {chips.map((id) => (
          <button
            key={id}
            className={`chip chip-word ${matched.has(id) ? 'done' : ''} ${selected === id ? 'on' : ''} ${drag?.id === id && moved.current ? 'ghost' : ''}`}
            disabled={matched.has(id)}
            data-chip={id}
            onPointerDown={(e) => onPointerDown(e, id)}
            onPointerUp={(e) => onPointerUp(e, id)}
            onPointerCancel={() => setDrag(null)}
          >
            {getWord(id).en}
          </button>
        ))}
      </div>
      <div className="match-grid">
        {pictures.map((id) => (
          <button
            key={id}
            data-target={id}
            className={`match-target ${matched.has(id) ? 'done' : ''} ${wrong === id ? 'shake' : ''} ${hover === id ? 'hover' : ''}`}
            onClick={() => selected && !matched.has(id) && attempt(selected, id)}
            aria-label={matched.has(id) ? getWord(id).en : 'Hedef'}
          >
            {target(id)}
            {matched.has(id) && <span className="match-label">{getWord(id).en}</span>}
          </button>
        ))}
      </div>
      {drag && moved.current && (
        <div className="drag-ghost chip chip-word on" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy }}>
          {getWord(drag.id).en}
        </div>
      )}
    </div>
  );
}

/**
 * Deterministic shuffle (stable between renders). Never returns the input
 * order, so pictures and words are not lined up.
 */
export function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let a = (seed * 2654435761) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((x, i) => x === arr[i])) out.push(out.shift()!);
  return out;
}
