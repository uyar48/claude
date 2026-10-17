import { Link, useNavigate } from 'react-router-dom';
import { course } from '../../content';
import { knownLemmas, sentenceUsable, textCoverage, unitLearned, unitTestOpen } from '../../core/course';
import { UNIT_TEST_SIZE } from '../../core/session';
import { speaker } from '../../audio/speaker';
import { IconBack } from '../components/Icons';
import { useAppState } from '../hooks';

const pct = (x: number) => Math.round(x * 100);

/** "İlerleme": what the learner can read now, unit by unit, with unit tests. */
export function ProgressScreen() {
  const state = useAppState();
  const navigate = useNavigate();
  const known = knownLemmas(course, state.cards);
  const coverage = textCoverage(course, known);
  const readable = course.texts.filter((t) => sentenceUsable(course, t, known)).length;
  const read = new Set(state.lessons.flatMap((l) => l.textIds ?? [])).size;
  const learned = [...state.cards.values()].filter((c) => c.state !== 'new' && course.words[c.wordId]).length;
  const recent = state.lessons
    .filter((l) => l.completedAt !== null && l.reviewed > 0)
    .sort((a, b) => a.number - b.number)
    .slice(-8);

  function startTest(unit: number) {
    speaker.unlock();
    navigate(`/test/${unit}`);
  }

  return (
    <div className="screen progress">
      <header className="top">
        <Link to="/" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>İlerleme</h1>
        <span />
      </header>

      <section className="panel coverage" aria-label="Metin kapsamı">
        <p className="eyebrow">Okuma</p>
        <p className="big-num">%{pct(coverage)}</p>
        <p>Sıradan bir İngilizce metinde her 100 kelimenin yaklaşık {pct(coverage)} tanesini tanıyorsun.</p>
        <div className="meter" role="img" aria-label={`Yüzde ${pct(coverage)}`}>
          <span style={{ width: `${pct(coverage)}%` }} />
          <i style={{ left: '95%' }} title="Sözlüksüz rahat okuma" />
        </div>
        <p className="muted small">
          {learned} kelime biliyorsun. Sözlüksüz rahat okumak için bu oranın %95'e yaklaşması gerekir; bu yüzden kursun
          metinleri yalnızca bildiğin kelimelerle yazılır. Hesap NGSL kelime sıklıklarına dayanır.
        </p>
        <p className="small">
          Kurs metinleri: <strong>{readable}</strong> / {course.texts.length} okunabilir · <strong>{read}</strong> tanesini okudun
        </p>
      </section>

      <section className="panel" aria-label="Üniteler">
        <p className="eyebrow">Üniteler</p>
        <ul className="units">
          {course.units.map((u) => {
            const { learned: n, total } = unitLearned(course, state.cards, u.n);
            const result = state.settings.unitTests[String(u.n)];
            const open = unitTestOpen(course, state.cards, u.n);
            return (
              <li key={u.n} className="unit-row">
                <div className="row gap-s">
                  <strong className="grow">{u.titleTr}</strong>
                  <span className="muted small">
                    {n} / {total}
                  </span>
                </div>
                <div className="meter thin">
                  <span style={{ width: `${(n / Math.max(1, total)) * 100}%` }} />
                </div>
                {result ? (
                  <p className="small row gap-s">
                    <span className="grow">
                      Test: <strong>%{pct(result.score / result.total)}</strong>
                      {result.best > result.score && <span className="muted"> · en iyi %{pct(result.best / result.total)}</span>}
                    </span>
                    <button className="link small" onClick={() => startTest(u.n)}>
                      Yeniden çöz
                    </button>
                  </p>
                ) : open ? (
                  <button className="btn btn-secondary" onClick={() => startTest(u.n)}>
                    Ünite testini çöz · {UNIT_TEST_SIZE} soru, ~5 dk
                  </button>
                ) : n > 0 ? (
                  <p className="muted small">Kelimelerin hepsi gelince kısa bir test açılacak.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="panel" aria-label="Son dersler">
          <p className="eyebrow">Son derslerde doğru cevap</p>
          <ul className="bars">
            {recent.map((l) => {
              const acc = l.correct / l.reviewed;
              return (
                <li key={l.id}>
                  <span className="muted small">{l.number}. ders</span>
                  <span className="meter thin">
                    <span style={{ width: `${pct(acc)}%` }} />
                  </span>
                  <span className="small">%{pct(acc)}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Doğru oranın yüksekse dersler zor alıştırmalara daha erken geçer; düşükse daha kolay alıştırmalarla devam eder.
          </p>
        </section>
      )}
    </div>
  );
}
