import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { course, credits } from '../../content';
import { creditLine, imageFor, imageStatus } from '../../content/media';
import { IconBack } from '../components/Icons';
import { useAppState } from '../hooks';

const SOURCE_INFO = [
  {
    key: 'pexels',
    name: 'Pexels',
    env: 'PEXELS_API_KEY',
    url: 'https://www.pexels.com/api/',
    note: 'İsteğe bağlı. Pexels şu an yeni API anahtarı vermiyor; anahtar olmadan Pixabay ve açık kaynaklar yeterli. Kullanılırsa her fotoğrafta fotoğrafçı ve Pexels bağlantısı gösterilir.',
    optional: true,
  },
  {
    key: 'pixabay',
    name: 'Pixabay',
    env: 'PIXABAY_API_KEY',
    url: 'https://pixabay.com/api/docs/',
    note: 'Ücretsiz anahtar. Fotoğraflar indirilip bu sitede barındırılır (doğrudan bağlantı yok), arama sonuçları 24 saat saklanır.',
    optional: false,
  },
  {
    key: 'wikimedia',
    name: 'Wikimedia Commons',
    env: null,
    url: 'https://commons.wikimedia.org',
    note: 'Anahtar gerekmez. Her fotoğrafın kendi lisansı ve yazarı Kaynaklar ekranında.',
    optional: false,
  },
  {
    key: 'openverse',
    name: 'Openverse',
    env: null,
    url: 'https://openverse.org',
    note: 'Anahtar gerekmez. Açık lisanslı (CC) fotoğraflar; lisans ve yazar her fotoğrafta kayıtlı.',
    optional: false,
  },
] as const;

/** Settings → "Görsel kaynakları": where pictures come from and what is missing. */
export function ImageSources() {
  const { mediaChoices } = useAppState();
  const s = imageStatus(mediaChoices);
  return (
    <div className="screen settings">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Görsel kaynakları</h1>
        <span />
      </header>
      <section className="panel">
        <h2>Durum</h2>
        <ul className="small stats">
          <li>
            Somut kelimeler: <strong>{s.concreteWithPhoto} / {s.concrete}</strong> fotoğraflı
          </li>
          <li>
            Fotoğrafsız soyut kelimeler: <strong>{s.withEmojiOnly}</strong> emoji ile, <strong>{s.neither}</strong> yalnızca
            cümle + ses ile öğretiliyor
          </li>
          {Object.entries(s.bySource).map(([k, n]) => (
            <li key={k}>
              {SOURCE_INFO.find((x) => x.key === k)?.name ?? k}: {n} fotoğraf
            </li>
          ))}
          {s.generatedAt && <li className="muted">Son indirme: {new Date(s.generatedAt).toLocaleDateString('tr-TR')}</li>}
        </ul>
      </section>
      {SOURCE_INFO.map((src) => {
        const missing = src.env && s.missingKeys.includes(src.env);
        return (
          <section key={src.key} className="panel">
            <div className="row gap">
              <h2>{src.name}</h2>
              <span className="grow" />
              <span className={`small ${missing && !src.optional ? 'warn-text' : missing ? 'muted' : 'ok-text'}`}>
                {missing ? (src.optional ? 'Kullanılmıyor' : 'Anahtar eksik') : 'Kullanılıyor'}
              </span>
            </div>
            <p className="small">{src.note}</p>
            {missing && !src.optional && (
              <p className="notice small">
                {src.env} eklenmemiş. {src.name} sitesinden ücretsiz bir anahtar al ({src.url}) ve ortam ayarlarına{' '}
                <code>{src.env}</code> adıyla ekle (Claude Code: ortamı düzenle → ortam değişkenleri). Anahtarı sohbete
                yapıştırma. Eklenince görseller yeniden indirilir; o zamana kadar Wikimedia Commons ve Openverse kullanılır.
              </p>
            )}
          </section>
        );
      })}
      <p className="center small">
        <Link to="/admin/review">Fotoğrafları gözden geçir ve seç</Link> · <Link to="/kaynaklar">Kaynaklar ve lisanslar</Link>
      </p>
    </div>
  );
}

/** Credits for every source: word list, sentences, photos, audio. */
export function Credits() {
  const { mediaChoices } = useAppState();
  const owners = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of course.sentences) {
      if (s.src !== 'tatoeba') continue;
      for (const o of [s.enOwner, s.trOwner]) if (o) m.set(o, (m.get(o) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);
  const tatoeba = course.sentences.filter((s) => s.src === 'tatoeba');
  const photos = course.order.map((id) => [id, imageFor(id, mediaChoices)] as const).filter(([, p]) => p);

  return (
    <div className="screen settings credits">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Kaynaklar</h1>
        <span />
      </header>

      {course.sources.map((s) => (
        <section key={s.name} className="panel">
          <h2>{s.name}</h2>
          <p className="small">{s.note}</p>
          <p className="small">
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.url}
            </a>{' '}
            · Lisans:{' '}
            <a href={s.licenseUrl} target="_blank" rel="noreferrer">
              {s.license}
            </a>
          </p>
        </section>
      ))}

      <section className="panel">
        <h2>Tatoeba cümle sahipleri</h2>
        <p className="small">
          {tatoeba.length} İngilizce–Türkçe cümle çifti tatoeba.org’dan alındı (CC BY 2.0 FR). Değişiklik: yalnızca seçildi,
          metin değiştirilmedi. Katkıda bulunanlar (cümle sayısıyla):
        </p>
        <p className="small owners">
          {owners.map(([o, n]) => (
            <span key={o}>
              <a href={`https://tatoeba.org/user/profile/${encodeURIComponent(o)}`} target="_blank" rel="noreferrer">
                {o}
              </a>{' '}
              ({n}){' '}
            </span>
          ))}
        </p>
        <details className="small">
          <summary>Cümle listesi</summary>
          <ul className="sentence-credits">
            {tatoeba.map((s) => (
              <li key={s.id}>
                <a href={`https://tatoeba.org/sentences/show/${s.id.slice(2)}`} target="_blank" rel="noreferrer" lang="en">
                  {s.en}
                </a>{' '}
                — {s.enOwner}
                {s.trId && (
                  <>
                    {' / '}
                    <a href={`https://tatoeba.org/sentences/show/${s.trId}`} target="_blank" rel="noreferrer">
                      {s.tr}
                    </a>{' '}
                    — {s.trOwner}
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="panel">
        <h2>Fotoğraflar</h2>
        {photos.length === 0 ? (
          <p className="small muted">Henüz fotoğraf yok.</p>
        ) : (
          <ul className="small photo-credits">
            {photos.map(([id, p]) => (
              <li key={id}>
                <strong lang="en">{course.words[id].en}</strong>:{' '}
                <a href={p!.url} target="_blank" rel="noreferrer">
                  {p!.title || 'fotoğraf'}
                </a>{' '}
                · {creditLine(p!)} · {p!.licenseUrl ? <a href={p!.licenseUrl} target="_blank" rel="noreferrer">{p!.license}</a> : p!.license}
              </li>
            ))}
          </ul>
        )}
        {credits.generatedAt && <p className="tiny muted">Fotoğraflar 4:3 kırpıldı ve küçültüldü.</p>}
      </section>

      <section className="panel">
        <h2>Ses ve diğerleri</h2>
        <ul className="small">
          <li>Sesler: Kokoro-82M (Apache 2.0) ile üretildi; olmayanlar cihazın kendi sesiyle okunur.</li>
          <li>İlk 20 kelimenin ve ilk metinlerin sesleri ElevenLabs ile üretilmişti.</li>
          <li>Emojiler cihazın kendi emoji yazı tipiyle gösterilir.</li>
          <li>İlk derslerin cümleleri ve kısa metinler bu uygulama için yazıldı.</li>
        </ul>
      </section>
    </div>
  );
}
