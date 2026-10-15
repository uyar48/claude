import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { course, getWord } from '../../content';
import { goalDays, minutesOn, streakInfo } from '../../core/progress';
import { localDate } from '../../core/time';
import { speaker } from '../../audio/speaker';
import { cacheMedia, type CacheReport } from '../../push/precache';
import { permission, pushAvailability } from '../../push/push';
import { IconGear } from '../components/Icons';
import { Picture } from '../components/Picture';
import { longDate } from '../format';
import { useAppState, useNow, useOnline, useRuntime } from '../hooks';
import { lessonMedia, nextLesson, startLesson } from '../lesson/start';

export function Today() {
  const rt = useRuntime();
  const state = useAppState();
  const now = useNow();
  const online = useOnline();
  const navigate = useNavigate();
  const tz = state.settings.timezone;
  const today = localDate(now, tz);
  const goal = state.settings.goalMinutes;
  const paused = state.settings.paused;

  const plan = useMemo(() => nextLesson(rt, now), [rt, now, state.cards, state.lessons, state.settings]);
  const inProgress = state.progress;
  const number = inProgress?.number ?? plan.number;
  const newWords = inProgress?.session.newWords ?? plan.newWords;
  const reviews = inProgress?.session.reviewWords.length ?? plan.reviewWords.length;
  const todayMin = minutesOn(state.lessons, today);
  const streak = streakInfo(goalDays(state.lessons, goal), today);
  const learned = [...state.cards.values()].filter((c) => c.state !== 'new' && course.words[c.wordId]).length;
  const unit = course.units.find((u) => newWords.some((w) => u.words.includes(w))) ?? course.units.at(-1)!;

  // Keep the next lesson's media in the offline cache.
  const [offline, setOffline] = useState<CacheReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    void cacheMedia(lessonMedia(rt, plan)).then((r) => {
      if (!cancelled) setOffline(r);
    });
    return () => {
      cancelled = true;
    };
  }, [rt, plan]);

  async function begin() {
    speaker.unlock();
    await startLesson(rt);
    navigate('/lesson');
  }

  async function resume() {
    await rt.store.updateSettings((s) => ({ ...s, paused: false, pausedAt: null }));
  }

  const askPush = !paused && pushAvailability(rt).ok && permission() === 'default';
  const goalDone = todayMin >= goal;

  return (
    <div className="screen today">
      <header className="top">
        <div>
          <p className="muted small cap">{longDate(now, tz)}</p>
          <h1>Bugün</h1>
        </div>
        <Link to="/settings" className="icon-btn" aria-label="Ayarlar">
          <IconGear />
        </Link>
      </header>

      {paused && (
        <section className="panel pause-card" aria-label="Ara verildi">
          <p className="eyebrow">Ara verdin</p>
          <p>Bildirimler kapalı. Hazır olduğunda kaldığın yerden devam edersin; tekrarlar günde en fazla 40 kartla gelir.</p>
          <button className="btn btn-secondary" onClick={resume}>
            Aradan dön
          </button>
        </section>
      )}

      <div className="goal" aria-label="Günlük hedef">
        <div className="goal-bar">
          <span style={{ width: `${Math.min(100, (todayMin / goal) * 100)}%` }} />
        </div>
        <p className="small">
          {goalDone ? (
            <>
              <strong>Günlük hedef tamam</strong> · {Math.round(todayMin)} dk. İstersen devam edebilirsin.
            </>
          ) : (
            <>
              Bugün <strong>{Math.round(todayMin)} / {goal} dk</strong>
            </>
          )}
        </p>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="num">{streak.days}</span>
          <span className="lbl">gün seri</span>
        </div>
        <div className="stat">
          <span className="num">{learned}</span>
          <span className="lbl">kelime</span>
        </div>
        <div className="stat">
          <span className="num">{number - 1}</span>
          <span className="lbl">ders bitti</span>
        </div>
      </div>
      {streak.frozen > 0 && (
        <p className="muted small freeze">Ara verdiğin günler seriyi bozmaz; seri, çalıştığın günleri sayar.</p>
      )}

      <section className="panel lesson-card">
        <p className="eyebrow">
          {unit.titleTr} · {number}. ders
        </p>
        <h2>{inProgress ? 'Kaldığın yerden devam et' : goalDone ? 'Bir ders daha?' : 'Sıradaki ders'}</h2>
        <ul className="plan">
          {reviews > 0 && <li>{reviews} kelime tekrarı</li>}
          {newWords.length > 0 && <li>{newWords.length} yeni kelime</li>}
          <li>Okuma, dinleme ve kısa alıştırmalar</li>
          <li>Yaklaşık {goal} dakika</li>
        </ul>
        {plan.reviewsDeferred > 0 && !inProgress && (
          <p className="muted small">Kalan {plan.reviewsDeferred} tekrar sonraki günlere yayılacak.</p>
        )}
        {newWords.length > 0 && (
          <div className="preview">
            {newWords.slice(0, 10).map((id) => (
              <div key={id} className="preview-word">
                <Picture wordId={id} size="sm" />
                <span lang="en">{getWord(id).en}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button className="btn btn-primary start" onClick={begin}>
        {inProgress ? 'Devam et' : 'Başla'}
      </button>

      {askPush && (
        <Link to="/settings#bildirimler" className="notice">
          Günlük hatırlatma ister misin? Bildirimleri ayarlardan açabilirsin.
        </Link>
      )}

      <footer className="status small muted">
        {!online && <span>Çevrimdışı · </span>}
        {offline && offline.total > 0 && offline.failed === 0 && <span>Sonraki ders çevrimdışı hazır · </span>}
        {state.sync.status === 'local' ? (
          <span>Yalnız bu cihaz (senkron kapalı)</span>
        ) : state.sync.status === 'error' ? (
          <span>Senkron şu an yapılamadı, sonra yeniden denenecek</span>
        ) : state.sync.status === 'syncing' ? (
          <span>Senkronlanıyor…</span>
        ) : (
          <span>Senkron açık</span>
        )}
      </footer>
    </div>
  );
}
