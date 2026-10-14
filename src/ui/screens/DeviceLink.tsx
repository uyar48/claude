import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isIOS, isStandalone } from '../../push/push';
import { IconBack } from '../components/Icons';
import { useRuntime } from '../hooks';

/** Shows a one-time code that signs another device (e.g. the home-screen app) into this account. */
export function DeviceLinkScreen() {
  const rt = useRuntime();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function load() {
    setError(null);
    setCode(null);
    try {
      const token = (await rt.supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch('/api/link/create', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(String(res.status));
      setCode(await res.json());
    } catch {
      setError('Kod alınamadı. İnternet bağlantını kontrol edip yeniden dene.');
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  const fromSafari = isIOS() && !isStandalone();

  return (
    <div className="screen settings">
      <header className="top">
        <Link to="/settings" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Cihaz bağla</h1>
        <span />
      </header>
      <section className="panel center">
        {fromSafari && <p>Giriş yapıldı. Şimdi ana ekrandaki <strong>Okuma</strong> uygulamasına dön ve bu kodu yaz:</p>}
        {!fromSafari && <p>Diğer cihazda giriş ekranındaki “Cihaz kodu” alanına bu kodu yaz:</p>}
        {code && left > 0 ? (
          <>
            <p className="link-code" aria-label={`Kod ${code.code.split('').join(' ')}`}>
              {code.code.slice(0, 3)} {code.code.slice(3)}
            </p>
            <p className="muted small">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} içinde geçerli · tek kullanımlık
            </p>
          </>
        ) : code ? (
          <p className="muted">Kodun süresi doldu.</p>
        ) : (
          !error && <p className="muted">Kod hazırlanıyor…</p>
        )}
        {error && <p className="warn">{error}</p>}
        <button className="btn btn-secondary" onClick={load}>
          Yeni kod al
        </button>
      </section>
      {fromSafari && (
        <section className="panel small">
          <h2>Ana ekranda Okuma yoksa</h2>
          <ol>
            <li>Alttaki Paylaş düğmesine dokun → “Ana Ekrana Ekle” → “Ekle”.</li>
            <li>Ana ekrandaki Okuma simgesinden aç; giriş ekranında bu kodu yaz.</li>
          </ol>
        </section>
      )}
    </div>
  );
}
