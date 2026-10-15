import { useEffect } from 'react';

/**
 * Result bar under an exercise. A right answer moves on by itself after a
 * moment; a wrong one waits for "Devam" so the correct answer can be read.
 */
export function Feedback({
  ok,
  text,
  onNext,
  auto = true,
}: {
  ok: boolean;
  text?: string;
  onNext: () => void;
  auto?: boolean;
}) {
  useEffect(() => {
    if (!ok || !auto) return;
    const t = setTimeout(onNext, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, auto]);
  return (
    <div className={`feedback ${ok ? 'ok' : 'no'}`} role="status">
      <span>{text ?? (ok ? 'Doğru.' : 'Doğrusu işaretli.')}</span>
      <button className="btn btn-primary" onClick={onNext} autoFocus>
        Devam
      </button>
    </div>
  );
}
