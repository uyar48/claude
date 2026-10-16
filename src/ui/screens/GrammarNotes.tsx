import { Link } from 'react-router-dom';
import { course } from '../../content';
import { IconBack } from '../components/Icons';
import { GrammarBody } from '../exercises/GrammarCard';
import { useAppState } from '../hooks';

/** Settings → "Dilbilgisi notları": every grammar card seen so far, to read again. */
export function GrammarNotes() {
  const { settings } = useAppState();
  const seen = new Set(settings.grammarSeen);
  const cards = (course.grammar ?? []).filter((g) => seen.has(g.id));
  const upcoming = (course.grammar ?? []).length - cards.length;
  return (
    <div className="screen settings">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Dilbilgisi notları</h1>
        <span />
      </header>
      {cards.length === 0 ? (
        <p className="muted">Henüz not yok. Notlar, ilgili kelimeyi öğrendiğin derste kısa bir kart olarak gelir.</p>
      ) : (
        cards.map((g) => (
          <section key={g.id} className="panel grammar-card">
            <GrammarBody g={g} />
          </section>
        ))
      )}
      {upcoming > 0 && <p className="muted small center">{upcoming} not daha ileriki derslerde gelecek.</p>}
    </div>
  );
}
