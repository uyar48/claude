import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { isIOS, isStandalone } from '../../push/push';
import { useRuntime } from '../hooks';

/**
 * Sign-in. In a normal browser the e-mail link signs this browser in.
 * The iPhone home-screen app has its own storage, so there the link opens
 * Safari, which then shows a 6-digit device code to type here.
 */
export function Login() {
  const rt = useRuntime();
  const homeScreenApp = isIOS() && isStandalone();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!rt.supabase || rt.session) return <Navigate to="/" replace />;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          redirectTo: `${window.location.origin}${homeScreenApp ? '/baglan' : '/'}`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(
          body.error === 'not-allowed'
            ? 'Bu e-posta ile giriş yapılamıyor.'
            : body.error === 'not-configured'
              ? 'Sunucu kurulumu tamamlanmamış.'
              : res.status === 429
                ? 'Çok sık e-posta istendi. Biraz bekleyip yeniden dene ya da son gelen e-postayı kullan.'
                : `E-posta gönderilemedi. ${body.detail ?? ''}`,
        );
        return;
      }
      setSent(true);
    } catch {
      setError('Bağlantı kurulamadı. İnternetini kontrol edip yeniden dene.');
    } finally {
      setBusy(false);
    }
  }

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/link/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
      if (!res.ok || !body.access_token || !body.refresh_token) {
        setError(body.error === 'invalid-code' || body.error === 'bad-code' ? 'Kod geçersiz ya da süresi dolmuş. Yeni bir kod al.' : 'Giriş yapılamadı, yeniden dene.');
        return;
      }
      const { error: err } = await rt.supabase!.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
      if (err) {
        setError('Giriş yapılamadı, yeniden dene.');
        return;
      }
      window.location.replace('/');
    } catch {
      setError('Bağlantı kurulamadı. İnternetini kontrol edip yeniden dene.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen login">
      <h1>Okuma</h1>
      <p className="muted">Günde 30 dakikayla İngilizce okumayı öğren.</p>

      {!sent ? (
        <form className="panel" onSubmit={send}>
          <label className="stack">
            <span>E-posta</span>
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn-primary wide" disabled={busy}>
            Giriş bağlantısı gönder
          </button>
        </form>
      ) : (
        <div className="panel">
          <p>
            <strong>{email}</strong> adresine bir giriş e-postası gönderdik.
          </p>
          {homeScreenApp ? (
            <ol className="small">
              <li>E-postadaki <strong>Sign in</strong> bağlantısına dokun. Safari açılacak.</li>
              <li>Safari’de 6 haneli bir kod göreceksin.</li>
              <li>Bu uygulamaya dön ve kodu aşağıya yaz.</li>
            </ol>
          ) : (
            <p className="muted small">E-postadaki “Sign in” bağlantısına bu cihazda dokun; giriş kendiliğinden olur.</p>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setSent(false)}>
            Geri
          </button>
        </div>
      )}

      <form className="panel" onSubmit={redeem}>
        <h2>Cihaz kodu</h2>
        <p className="muted small">
          {homeScreenApp
            ? 'Safari’de ya da giriş yapılmış başka bir cihazda gösterilen 6 haneli kodu yaz.'
            : 'Başka bir cihazda giriş yaptıysan, oradaki Ayarlar → “Başka cihazı bağla” kodunu buraya yazabilirsin.'}
        </p>
        <label className="stack">
          <span>Kod</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button className="btn btn-secondary wide" disabled={busy}>
          Kodla giriş yap
        </button>
      </form>

      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
