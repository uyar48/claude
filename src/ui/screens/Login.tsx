import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { isIOS, isStandalone } from '../../push/push';
import { useRuntime } from '../hooks';

/**
 * E-mail sign-in. The e-mail contains both a link and a 6-digit code: on iPhone
 * the home-screen app has its own storage, so the code is the reliable way in.
 */
export function Login() {
  const rt = useRuntime();
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
        body: JSON.stringify({ email: email.trim(), redirectTo: `${window.location.origin}/` }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(
          body.error === 'not-allowed'
            ? 'Bu e-posta ile giriş yapılamıyor.'
            : body.error === 'not-configured'
              ? 'Sunucu kurulumu tamamlanmamış.'
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

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await rt.supabase!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) {
      setError('Kod kabul edilmedi. Son gelen e-postadaki kodu dene.');
      return;
    }
    window.location.replace('/');
  }

  return (
    <div className="screen login">
      <h1>Okuma</h1>
      <p className="muted">Günde 30 dakikayla İngilizce okumayı öğren.</p>
      {!sent ? (
        <form className="panel" onSubmit={send}>
          <label className="stack">
            <span>E-posta</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn btn-primary wide" disabled={busy}>
            Giriş bağlantısı gönder
          </button>
        </form>
      ) : (
        <form className="panel" onSubmit={verify}>
          <p>
            <strong>{email}</strong> adresine bir e-posta gönderdik.
          </p>
          <p className="muted small">
            {isIOS() && isStandalone()
              ? 'E-postadaki 6 haneli kodu buraya yaz. (Bağlantı Safari’de açılır; ana ekran uygulaması için kod gerekir.)'
              : 'E-postadaki bağlantıya bu cihazda dokunabilir ya da 6 haneli kodu buraya yazabilirsin.'}
          </p>
          <label className="stack">
            <span>Kod</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="btn btn-primary wide" disabled={busy}>
            Giriş yap
          </button>
          <button type="button" className="btn btn-ghost wide" onClick={() => setSent(false)}>
            Geri
          </button>
        </form>
      )}
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
