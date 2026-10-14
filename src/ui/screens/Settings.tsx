import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mediaStatus } from '../../content/media';
import { inQuietHours } from '../../core/scheduler';
import { LESSON_MINUTE_OPTIONS, type NotificationTypeSetting, type Settings } from '../../core/settings';
import { parseHm } from '../../core/time';
import {
  disablePush,
  enablePush,
  isIOS,
  isStandalone,
  permission,
  pushAvailability,
  sendTestNotification,
} from '../../push/push';
import { IconBack } from '../components/Icons';
import { clock } from '../format';
import { useAppState, useRuntime } from '../hooks';

export function SettingsScreen() {
  const rt = useRuntime();
  const { settings, sync } = useAppState();
  const navigate = useNavigate();
  const update = (fn: (s: Settings) => Settings) => void rt.store.updateSettings(fn);
  const n = settings.notifications;

  const setType = (kind: 'lesson' | 'review', patch: Partial<NotificationTypeSetting>) =>
    update((s) => ({
      ...s,
      notifications: { ...s.notifications, [kind]: { ...s.notifications[kind], ...patch } },
    }));

  useEffect(() => {
    if (window.location.hash === '#bildirimler') document.getElementById('bildirimler')?.scrollIntoView();
  }, []);

  return (
    <div className="screen settings">
      <header className="top">
        <button className="icon-btn" aria-label="Geri" onClick={() => navigate('/')}>
          <IconBack />
        </button>
        <h1>Ayarlar</h1>
        <span />
      </header>

      <section className="panel">
        <h2>Ders süresi</h2>
        <div className="segmented" role="radiogroup" aria-label="Ders süresi">
          {LESSON_MINUTE_OPTIONS.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={settings.lessonMinutes === m}
              className={settings.lessonMinutes === m ? 'on' : ''}
              onClick={() => update((s) => ({ ...s, lessonMinutes: m }))}
            >
              {m} dk
            </button>
          ))}
        </div>
        <p className="muted small">Tekrar, yeni kelimeler, okuma, sınav ve özet bu süreye göre bölünür. Günde {settings.newPerDay} yeni kelime.</p>
      </section>

      <section className="panel" id="bildirimler">
        <h2>Bildirimler</h2>
        <PushControls />
        <TypeRow
          label="Günlük ders hatırlatması"
          help="Seçtiğin saatte, o gün ders yapılmadıysa. Günde en fazla 1."
          value={n.lesson}
          quiet={n.quietHours}
          onChange={(p) => setType('lesson', p)}
        />
        <TypeRow
          label="Tekrar bildirimi"
          help="Vadesi gelen kelime varsa. Günde en fazla 1."
          value={n.review}
          quiet={n.quietHours}
          onChange={(p) => setType('review', p)}
        />
        <div className="field-row quiet">
          <span>Sessiz saatler</span>
          <span className="row gap-s">
            <input
              type="time"
              aria-label="Sessiz saat başlangıcı"
              value={n.quietHours.start}
              onChange={(e) =>
                e.target.value &&
                update((s) => ({ ...s, notifications: { ...s.notifications, quietHours: { ...s.notifications.quietHours, start: e.target.value } } }))
              }
            />
            –
            <input
              type="time"
              aria-label="Sessiz saat bitişi"
              value={n.quietHours.end}
              onChange={(e) =>
                e.target.value &&
                update((s) => ({ ...s, notifications: { ...s.notifications, quietHours: { ...s.notifications.quietHours, end: e.target.value } } }))
              }
            />
          </span>
        </div>
        <p className="muted small">
          Saatler {settings.timezone} saatine göre. Üst üste 3 bildirim açılmazsa bildirimler kendiliğinden seyrekleşir;
          uygulamayı açınca eski sıklığa döner.
        </p>
      </section>

      <AccountSection syncStatus={sync.status} lastSyncAt={sync.lastSyncAt} />
      <SetupSection />
      {isIOS() && !isStandalone() && <InstallHelp />}

      <p className="center small">
        <Link to="/admin/review">Medya inceleme (/admin/review)</Link>
      </p>
    </div>
  );
}

function TypeRow({
  label,
  help,
  value,
  quiet,
  onChange,
}: {
  label: string;
  help: string;
  value: NotificationTypeSetting;
  quiet: { start: string; end: string };
  onChange: (p: Partial<NotificationTypeSetting>) => void;
}) {
  const inQuiet = inQuietHours(parseHm(value.time), quiet);
  return (
    <div className="type-row">
      <label className="field-row">
        <span>{label}</span>
        <input type="checkbox" className="switch" checked={value.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
      </label>
      {value.enabled && (
        <label className="field-row sub">
          <span className="muted small">{help}</span>
          <input type="time" value={value.time} aria-label={`${label} saati`} onChange={(e) => e.target.value && onChange({ time: e.target.value })} />
        </label>
      )}
      {value.enabled && inQuiet && <p className="warn small">Bu saat sessiz saatlerin içinde; bildirim gönderilmez.</p>}
    </div>
  );
}

function PushControls() {
  const rt = useRuntime();
  const avail = pushAvailability(rt);
  const [perm, setPerm] = useState(permission());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!avail.ok) {
    const text = {
      'ios-not-installed': 'iPhone’da bildirimler yalnızca ana ekrana eklenen uygulamada çalışır. Aşağıdaki adımlarla ekle, sonra uygulamayı ana ekrandan aç.',
      unsupported: 'Bu tarayıcı web bildirimlerini desteklemiyor.',
      'no-server-key': 'Sunucuda VAPID anahtarı yok; bildirimler kurulum tamamlanınca açılabilir.',
    }[avail.reason];
    return <p className="notice">{text}</p>;
  }

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      await enablePush(rt); // permission prompt first, inside the tap
      setPerm(permission());
      setMsg('Bildirimler açık.');
    } catch (e) {
      setPerm(permission());
      const m = (e as Error).message;
      setMsg(m === 'denied' ? 'İzin verilmedi. Tarayıcı/iPhone ayarlarından açabilirsin.' : `Açılamadı: ${m}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendTestNotification(rt);
      setMsg(
        r.error
          ? `Gönderilemedi (${r.error}).`
          : r.via === 'server'
            ? `Test bildirimi gönderildi (${r.delivered}/${r.total} cihaz).`
            : 'Yerel test bildirimi gösterildi. Sunucu bildirimi için kurulum gerekli.',
      );
    } catch (e) {
      setMsg(`Gönderilemedi: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push">
      {perm === 'granted' ? (
        <div className="row gap wrap">
          <button className="btn btn-secondary" onClick={test} disabled={busy}>
            Test bildirimi gönder
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await disablePush(rt);
              setMsg('Bu cihazda bildirimler kapatıldı.');
            }}
            disabled={busy}
          >
            Bu cihazda kapat
          </button>
        </div>
      ) : perm === 'denied' ? (
        <p className="notice">Bildirim izni kapalı. iPhone: Ayarlar → Bildirimler → Okuma. Bilgisayar: adres çubuğundaki site ayarları.</p>
      ) : (
        <button className="btn btn-primary" onClick={turnOn} disabled={busy}>
          Bildirimlere izin ver
        </button>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}

function AccountSection({ syncStatus, lastSyncAt }: { syncStatus: string; lastSyncAt: number | null }) {
  const rt = useRuntime();
  if (!rt.supabase) {
    return (
      <section className="panel">
        <h2>Hesap ve senkron</h2>
        <p className="muted">Senkron kapalı: sunucuda Supabase ayarlı değil. İlerleme yalnızca bu cihazda saklanıyor.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Hesap ve senkron</h2>
      <p>{rt.session?.user.email}</p>
      <p className="muted small">
        Durum: {syncStatus === 'error' ? 'hata, yeniden denenecek' : syncStatus === 'offline' ? 'çevrimdışı' : syncStatus === 'syncing' ? 'senkronlanıyor' : 'güncel'}
        {lastSyncAt && ` · son senkron ${clock(lastSyncAt)}`}
      </p>
      <div className="row gap wrap">
        <button className="btn btn-secondary" onClick={() => rt.sync?.sync()}>
          Şimdi senkronla
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await rt.supabase!.auth.signOut();
            window.location.href = '/login';
          }}
        >
          Çıkış yap
        </button>
      </div>
    </section>
  );
}

function SetupSection() {
  const rt = useRuntime();
  const m = mediaStatus();
  const items: string[] = [];
  if (rt.config.fromCache && !rt.config.supabaseUrl) items.push('Sunucuya ulaşılamadı (yerel önizleme ya da çevrimdışı).');
  for (const k of rt.config.missing) items.push(`Sunucu ortam değişkeni eksik: ${k}`);
  for (const k of m.missingKeys) items.push(`${k} eksik: ${k.startsWith('IMAGE') ? 'görseller yer tutucu (düz renk + kelime)' : 'sesler tarayıcının sesiyle okunuyor'}`);
  if (m.images === 0) items.push('Medya henüz üretilmedi: görseller yer tutucu, sesler tarayıcının sesi.');
  if (!items.length) return null;
  return (
    <section className="panel">
      <h2>Kurulum durumu</h2>
      <ul className="small checklist">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  );
}

function InstallHelp() {
  return (
    <section className="panel">
      <h2>iPhone’a ekle</h2>
      <ol className="small">
        <li>Bu sayfayı Safari’de aç.</li>
        <li>Alttaki Paylaş düğmesine (kare ve yukarı ok) dokun.</li>
        <li>“Ana Ekrana Ekle”yi seç, sonra “Ekle”.</li>
        <li>Uygulamayı ana ekrandaki “Okuma” simgesinden aç ve giriş yap.</li>
        <li>Ayarlar → “Bildirimlere izin ver”.</li>
      </ol>
    </section>
  );
}
