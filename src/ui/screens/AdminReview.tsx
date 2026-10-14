import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { content, media } from '../../content';
import { AUDIO_BASE, IMAGE_BASE, imageFor, mediaStatus, sentenceAudio, wordAudio } from '../../content/media';
import { sentenceAudioKey, wordAudioKey } from '../../content/types';
import { safeStorage } from '../../data/runtime';
import { IconBack, IconSpeaker } from '../components/Icons';
import { Picture } from '../components/Picture';

type Verdict = 'approved' | 'regenerate';

interface ReviewState {
  images: Record<string, Verdict>;
  audio: Record<string, Verdict>;
  /** wordId → provider picked in the side-by-side comparison. */
  imagePick: Record<string, string>;
  /** sample key → provider picked in the voice comparison. */
  audioPick: Record<string, string>;
}

const KEY = 'okuma:media-review';

function load(): ReviewState {
  try {
    const raw = safeStorage.get(KEY);
    if (raw) return { images: {}, audio: {}, imagePick: {}, audioPick: {}, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { images: {}, audio: {}, imagePick: {}, audioPick: {} };
}

function play(url: string) {
  void new Audio(url).play().catch(() => {});
}

/** Media review: approve or ask to regenerate each picture and clip; pick providers. */
export function AdminReview() {
  const [state, setState] = useState<ReviewState>(load);
  const status = mediaStatus();
  const save = (s: ReviewState) => {
    setState(s);
    safeStorage.set(KEY, JSON.stringify(s));
  };
  const setVerdict = (kind: 'images' | 'audio', key: string, v: Verdict) =>
    save({ ...state, [kind]: { ...state[kind], [key]: state[kind][key] === v ? undefined : v } });

  const exportJson = useMemo(() => {
    const pick = (rec: Record<string, Verdict>, v: Verdict) =>
      Object.entries(rec)
        .filter(([, x]) => x === v)
        .map(([k]) => k);
    return JSON.stringify(
      {
        imageProvider: majority(state.imagePick),
        ttsProvider: majority(state.audioPick),
        approved: { images: pick(state.images, 'approved'), audio: pick(state.audio, 'approved') },
        regenerate: { images: pick(state.images, 'regenerate'), audio: pick(state.audio, 'regenerate') },
      },
      null,
      2,
    );
  }, [state]);

  const compareImages = media.compare?.images ?? {};
  const compareAudio = media.compare?.audio ?? {};

  return (
    <div className="screen admin">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Medya inceleme</h1>
        <span />
      </header>

      <section className="panel small">
        <p>
          Görsel sağlayıcı: <strong>{status.imageProvider ?? '—'}</strong> · Ses sağlayıcı: <strong>{status.ttsProvider ?? 'tarayıcı'}</strong>
        </p>
        <p>
          {status.images} görsel ({status.placeholders} yer tutucu) · {status.audio} ses klibi
        </p>
        {status.missingKeys.length > 0 && <p className="warn">Eksik anahtar: {status.missingKeys.join(', ')}</p>}
      </section>

      {Object.keys(compareImages).length > 0 && (
        <section className="panel">
          <h2>Görsel karşılaştırma</h2>
          <p className="muted small">Her kelime için daha gerçekçi olanı seç.</p>
          {Object.entries(compareImages).map(([wordId, byProvider]) => (
            <div key={wordId} className="compare-row">
              <h3 lang="en">{wordId}</h3>
              <div className="compare-grid">
                {Object.entries(byProvider).map(([provider, asset]) => (
                  <button
                    key={provider}
                    className={`compare-item ${state.imagePick[wordId] === provider ? 'on' : ''}`}
                    onClick={() => save({ ...state, imagePick: { ...state.imagePick, [wordId]: provider } })}
                  >
                    <img src={IMAGE_BASE + asset.file} alt={`${wordId} – ${provider}`} />
                    <span>{provider}{asset.model ? ` · ${asset.model}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="small">Seçimler: {tally(state.imagePick)}</p>
        </section>
      )}

      {Object.keys(compareAudio).length > 0 && (
        <section className="panel">
          <h2>Ses karşılaştırma</h2>
          {Object.entries(compareAudio).map(([sample, byProvider]) => (
            <div key={sample} className="compare-row">
              <h3 className="small" lang="en">{describeSample(sample)}</h3>
              <div className="row gap wrap">
                {Object.entries(byProvider).map(([provider, asset]) => (
                  <span key={provider} className={`chip ${state.audioPick[sample] === provider ? 'on' : ''}`}>
                    <button className="link" onClick={() => play(AUDIO_BASE + asset.file)} aria-label={`${provider} dinle`}>
                      <IconSpeaker />
                    </button>
                    <button className="link" onClick={() => save({ ...state, audioPick: { ...state.audioPick, [sample]: provider } })}>
                      {provider}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="small">Seçimler: {tally(state.audioPick)}</p>
          <p className="muted small">Hangi sütunu beğendiğini bana yazman yeterli; tüm sesleri o sesle üretirim.</p>
        </section>
      )}

      <section className="review-grid">
        {content.words.map((w) => {
          const img = imageFor(w.id);
          const fa = wordAudio(w.id, 'female');
          const ma = wordAudio(w.id, 'male');
          return (
            <article key={w.id} className="review-card">
              <Picture wordId={w.id} size="sm" />
              <div className="review-meta">
                <strong lang="en">{w.en}</strong> <span className="muted">{w.tr}</span>
                <p className="tiny muted">{img ? `${img.provider}${img.placeholder ? ' (yer tutucu)' : ''}` : 'görsel yok'}</p>
              </div>
              <div className="row gap-s wrap">
                {fa && (
                  <button className="chip" onClick={() => play(fa.url)}>
                    <IconSpeaker /> kadın
                  </button>
                )}
                {ma && (
                  <button className="chip" onClick={() => play(ma.url)}>
                    <IconSpeaker /> erkek
                  </button>
                )}
                {!fa && !ma && <span className="tiny muted">ses: tarayıcı</span>}
              </div>
              <div className="row gap-s wrap">
                <VerdictButtons value={state.images[w.id]} onChange={(v) => setVerdict('images', w.id, v)} label="Görsel" subject="Görseli" />
                {fa && (
                  <VerdictButtons
                    value={state.audio[wordAudioKey(w.id, 'female')]}
                    onChange={(v) => setVerdict('audio', wordAudioKey(w.id, 'female'), v)}
                    label="Ses"
                    subject="Sesi"
                  />
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel">
        <h2>Metin sesleri</h2>
        {content.texts.map((t) => (
          <div key={t.id} className="text-audio">
            <h3 lang="en">{t.title}</h3>
            {t.sentences.map((s, i) => {
              const a = sentenceAudio(t.id, i);
              const key = sentenceAudioKey(t.id, i);
              return (
                <div key={i} className="row gap-s wrap sent-row">
                  {a ? (
                    <button className="icon-btn" onClick={() => play(a.url)} aria-label="Dinle">
                      <IconSpeaker />
                    </button>
                  ) : (
                    <span className="tiny muted">tarayıcı</span>
                  )}
                  <span lang="en" className="grow">{s.en}</span>
                  {a && <span className="tiny muted">{a.timingSource ?? ''}</span>}
                  {a && <VerdictButtons value={state.audio[key]} onChange={(v) => setVerdict('audio', key, v)} label="" subject="Cümle sesini" />}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Dışa aktar</h2>
        <p className="muted small">
          Bu metni <code>content/media-review.json</code> dosyasına kaydet ya da GitHub’daki “Medya üret” iş akışının <em>review</em> alanına
          yapıştır. Onaylananlar korunur, “yeniden” işaretlenenler tekrar üretilir.
        </p>
        <textarea readOnly value={exportJson} rows={10} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(exportJson)}>
          Kopyala
        </button>
      </section>
    </div>
  );
}

function VerdictButtons({
  value,
  onChange,
  label,
  subject,
}: {
  value?: Verdict;
  onChange: (v: Verdict) => void;
  label: string;
  /** Accusative noun for the accessible name, e.g. "Görseli", "Sesi". */
  subject: string;
}) {
  return (
    <span className="verdict">
      {label && <span className="tiny muted">{label}</span>}
      <button
        className={`chip ${value === 'approved' ? 'on ok' : ''}`}
        aria-label={`${subject} onayla`}
        aria-pressed={value === 'approved'}
        onClick={() => onChange('approved')}
      >
        Onayla
      </button>
      <button
        className={`chip ${value === 'regenerate' ? 'on no' : ''}`}
        aria-label={`${subject} yeniden üret`}
        aria-pressed={value === 'regenerate'}
        onClick={() => onChange('regenerate')}
      >
        Yeniden üret
      </button>
    </span>
  );
}

/** "word:house:female" → "house (kadın sesi)", "sent:t5:0" → the sentence. */
function describeSample(key: string): string {
  const [kind, id, extra] = key.split(':');
  if (kind === 'word') return `${content.words.find((w) => w.id === id)?.en ?? id} (${extra === 'male' ? 'erkek' : 'kadın'} sesi)`;
  if (kind === 'sent') {
    const t = content.texts.find((x) => x.id === id);
    const s = t?.sentences[Number(extra)];
    return s ? `${s.en} (${t!.voice === 'male' ? 'erkek' : 'kadın'} sesi)` : key;
  }
  return key;
}

function majority(picks: Record<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const p of Object.values(picks)) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [p, c] of counts) if (c > n) [best, n] = [p, c];
  return best;
}

function tally(picks: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const p of Object.values(picks)) counts.set(p, (counts.get(p) ?? 0) + 1);
  return counts.size ? [...counts].map(([p, c]) => `${p}: ${c}`).join(' · ') : 'henüz yok';
}
