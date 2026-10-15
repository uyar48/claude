import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { course, credits } from '../../content';
import { IMAGE_BASE, creditLine, imageFor, imageStatus } from '../../content/media';
import { IconBack } from '../components/Icons';
import { useAppState, useRuntime } from '../hooks';

type Filter = 'all' | 'open' | 'decided';

/**
 * Picture review: for each word pick 1 of up to 5 stock-photo candidates, or
 * "Görsel yok" (the word is then taught with its emoji / a sentence + audio).
 * Choices are saved to the account, so every device shows the same picture.
 */
export function AdminReview() {
  const rt = useRuntime();
  const { mediaChoices, sync } = useAppState();
  const [filter, setFilter] = useState<Filter>('all');
  const status = imageStatus(mediaChoices);

  const words = useMemo(
    () => course.order.filter((id) => (credits.words[id]?.candidates.length ?? 0) > 0 || course.words[id].kind === 'concrete'),
    [],
  );
  const decided = (id: string) => Boolean(mediaChoices[id]?.rejected || mediaChoices[id]?.choice);
  const shown = words.filter((id) => (filter === 'all' ? true : filter === 'open' ? !decided(id) : decided(id)));

  return (
    <div className="screen admin">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Görsel seçimi</h1>
        <span />
      </header>
      <p className="muted small">
        Her kelime için en uygun fotoğrafı seç ya da “Görsel yok” de. Seçim hesabına kaydedilir; iPhone ve bilgisayar aynı
        resmi gösterir.{' '}
        {!rt.session && <strong>Giriş yapılmadığı için seçimler yalnızca bu cihazda kalır.</strong>}
        {rt.session && sync.status === 'error' && <strong>Senkron şu an yapılamadı; seçimler sonra gönderilecek.</strong>}
      </p>
      <p className="small">
        {status.concreteWithPhoto} / {status.concrete} somut kelimenin fotoğrafı var · {words.filter(decided).length}{' '}
        kelimede seçim yapıldı.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Filtre">
        {(
          [
            ['all', 'Hepsi'],
            ['open', 'Seçilmemiş'],
            ['decided', 'Seçilmiş'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {words.length === 0 && (
        <p className="notice">Henüz aday fotoğraf yok. Önce görselleri indir: npm run fetch-images</p>
      )}

      {shown.map((id) => {
        const w = course.words[id];
        const entry = credits.words[id];
        const choice = mediaChoices[id];
        const current = imageFor(id, mediaChoices);
        return (
          <section key={id} className="panel review-word" aria-label={`Kelime: ${w.en}`}>
            <div className="row gap">
              <h2 lang="en">{w.en}</h2>
              <span className="muted">{w.tr}</span>
              {w.emoji && <span aria-hidden>{w.emoji}</span>}
              <span className="grow" />
              <span className="small muted">
                {choice?.rejected ? 'Görsel yok' : decided(id) ? 'Seçildi' : current ? 'Varsayılan' : 'Fotoğraf yok'}
              </span>
            </div>
            {entry?.candidates.length ? (
              <div className="candidates">
                {entry.candidates.map((c, i) => {
                  const on = !choice?.rejected && current?.file === c.file;
                  return (
                    <button
                      key={c.file}
                      className={`candidate ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      aria-label={`${w.en}: aday ${i + 1} seç`}
                      onClick={() => rt.store.setMediaChoice({ wordId: id, choice: c.file, rejected: false })}
                    >
                      <img src={IMAGE_BASE + c.file} alt="" loading="lazy" />
                      <span className="tiny">{creditLine(c)}</span>
                      <span className="tiny muted">{c.license}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted small">Bu kelime için aday fotoğraf bulunamadı.</p>
            )}
            <div className="row gap wrap">
              <button
                className={`chip ${choice?.rejected ? 'on no' : ''}`}
                aria-pressed={Boolean(choice?.rejected)}
                aria-label={`${w.en}: görsel yok`}
                onClick={() => rt.store.setMediaChoice({ wordId: id, choice: null, rejected: true })}
              >
                Görsel yok (emoji / cümle + ses)
              </button>
              {decided(id) && (
                <button
                  className="chip"
                  aria-label={`${w.en}: seçimi geri al`}
                  onClick={() => rt.store.setMediaChoice({ wordId: id, choice: null, rejected: false })}
                >
                  Varsayılana dön
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
