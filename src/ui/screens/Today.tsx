import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { content, getText } from '../../content';
import { lessonMediaUrls } from '../../content/media';
import { completedToday, dueTodayCount } from '../../core/lesson';
import { streak } from '../../core/streak';
import { DAY, localDate } from '../../core/time';
import { speaker } from '../../audio/speaker';
import { cacheMedia, type CacheReport } from '../../push/precache';
import { permission, pushAvailability } from '../../push/push';
import { IconGear } from '../components/Icons';
import { Picture } from '../components/Picture';
import { longDate } from '../format';
import { useAppState, useNow, useOnline, useRuntime } from '../hooks';
import { currentPlan, startLesson } from '../lesson/start';

export function Today() {
  const rt = useRuntime();
  const state = useAppState();
  const now = useNow();
  const online = useOnline();
  const navigate = useNavigate();
  const tz = state.settings.timezone;
  const today = localDate(now, tz);

  const done = completedToday(state.lessons, now, tz);
  const inProgress = state.progress && state.progress.plan.date === today ? state.progress : null;
  const plan = useMemo(
    () => inProgress?.plan ?? currentPlan(rt, now),
    [rt, now, state.cards, state.lessons, state.settings, inProgress],
  );
  const due = dueTodayCount(state.cards.values(), now, tz);
  const days = streak(
    state.lessons.filter((l) => l.completedAt !== null).map((l) => l.date),
    today,
  );

  // Keep the next lesson's media in the offline cache.
  const [offline, setOffline] = useState<CacheReport | null>(null);
  useEffect(() => {
    const target = done ? currentPlan(rt, now + DAY) : plan;
    let cancelled = false;
    void cacheMedia(lessonMediaUrls(target)).then((r) => {
      if (!cancelled) setOffline(r);
    });
    return () => {
      cancelled = true;
    };
  }, [rt, plan, done, now]);

  async function begin() {
    speaker.unlock();
    await startLesson(rt);
    navigate('/lesson');
  }

  const text = plan.textId ? getText(plan.textId) : null;
  const askPush = pushAvailability(rt).ok && permission() === 'default';
  const nothingToDo = done && plan.reviewWordIds.length === 0 && plan.newWordIds.length === 0;

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

      <div className="stat-row">
        <div className="stat">
          <span className="num">{due}</span>
          <span className="lbl">tekrar</span>
        </div>
        <div className="stat">
          <span className="num">{days}</span>
          <span className="lbl">gün seri</span>
        </div>
        <div className="stat">
          <span className="num">{[...state.cards.values()].filter((c) => c.state !== 'new').length}</span>
          <span className="lbl">kelime</span>
        </div>
      </div>

      <section className="panel lesson-card">
        {done && !inProgress ? (
          <>
            <p className="eyebrow">Bugünkü ders tamam</p>
            <h2>İyi iş. Yarın yeni kelimeler var.</h2>
            {plan.reviewWordIds.length > 0 ? (
              <p className="muted">İstersen {plan.reviewWordIds.length} tekrarı şimdi yapabilirsin.</p>
            ) : (
              <p className="muted">İstersen bir metni yeniden okuyabilirsin.</p>
            )}
          </>
        ) : (
          <>
            <p className="eyebrow">
              {content.level.title} · Ünite {content.unit.order}: {content.unit.title} · Ders {plan.number}
            </p>
            <h2>{inProgress ? 'Kaldığın yerden devam et' : 'Günün dersi'}</h2>
            <ul className="plan">
              {plan.reviewWordIds.length > 0 && <li>{plan.reviewWordIds.length} kelime tekrarı</li>}
              {plan.newWordIds.length > 0 && <li>{plan.newWordIds.length} yeni kelime</li>}
              {text && (
                <li>
                  Metin: <span lang="en">{text.title}</span>
                </li>
              )}
              <li>Yaklaşık {plan.durationMin} dakika</li>
            </ul>
            {plan.newWordIds.length > 0 && (
              <div className="preview">
                {plan.newWordIds.map((id) => (
                  <Picture key={id} wordId={id} size="sm" />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <button className="btn btn-primary start" onClick={begin} disabled={nothingToDo && !text}>
        {inProgress ? 'Devam et' : done ? (plan.reviewWordIds.length ? 'Tekrar et' : 'Yeniden oku') : 'Başla'}
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
