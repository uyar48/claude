import { getGrammar } from '../../content';
import { grammarExampleKey } from '../../content/media';
import { speaker } from '../../audio/speaker';
import { IconPlay } from '../components/Icons';
import type { CourseGrammar } from '../../content/courseTypes';
import type { ExerciseProps } from './types';

/** The card's content: title, short Turkish explanation, table and examples with audio. */
export function GrammarBody({ g }: { g: CourseGrammar }) {
  return (
    <>
      <h2 className="grammar-title">{g.title}</h2>
      {g.body.map((p, i) => (
        <p key={i} className="grammar-text">
          {p}
        </p>
      ))}
      {g.table && (
        <table className="grammar-table">
          <tbody>
            {g.table.map(([en, tr]) => (
              <tr key={en}>
                <td lang="en">{en}</td>
                <td>{tr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="grammar-examples">
        {g.examples.map((e, i) => (
          <li key={e.en}>
            <button
              className="sent-play"
              aria-label={`Örnek ${i + 1}: dinle`}
              onClick={() => speaker.phrase(grammarExampleKey(g.id, i), e.en)}
            >
              <IconPlay />
            </button>
            <span>
              <span className="en" lang="en">
                {e.en}
              </span>
              <span className="tr">{e.tr}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A short grammar note inside the lesson. Not graded. */
export function GrammarCard({ ex, onDone }: ExerciseProps) {
  const g = getGrammar(ex.grammarId!);
  return (
    <div className="ex grammar">
      <p className="eyebrow">Kısa dilbilgisi notu</p>
      <div className="panel grammar-card">
        <GrammarBody g={g} />
      </div>
      <p className="muted small">Bu notları sonra Ayarlar → Dilbilgisi notları'nda yeniden okuyabilirsin.</p>
      <button className="btn btn-primary wide big" onClick={() => onDone({ correct: null })} autoFocus>
        Anladım
      </button>
    </div>
  );
}
