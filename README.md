# Okuma — kişisel İngilizce okuma uygulaması (Aşama 1)

Tek kullanıcılı, mobil öncelikli bir PWA. Hedef, günde 30 dakikayla kolaylaştırılmış İngilizce metinleri sözlüksüz okuyabilmek. Arayüz Türkçe, içerik İngilizce. Bu aşama **Seviye 0, Ünite 1 (Sabah)** için uçtan uca çalışan bir dilimdir: 20 kelime ve 5 metin; her metinde 3 anlama ve 3 boşluk doldurma sorusu var.

Canlı adres: **https://okuma-iota.vercel.app** · Kurulum: **[docs/KURULUM.md](docs/KURULUM.md)**

## Neler var

| Özellik | Nerede |
| --- | --- |
| "Bugün" ekranı: günün dersi, tekrar sayısı, seri, tek büyük **Başla** | `src/ui/screens/Today.tsx` |
| 30 dk ders akışı: tekrar 8 · yeni kelime 4 · okuma/dinleme 12 · mini sınav 4 · özet 2 (süre ayarlanabilir) | `src/core/lesson.ts`, `src/ui/screens/Lesson.tsx` |
| Resim kartı (resim → ses → Türkçe), sürükle-bırak eşleştirme (dokunmatik uyumlu) | `src/ui/lesson/NewWordsStep.tsx`, `src/ui/components/MatchGame.tsx` |
| Dokunarak okuma (resim ve anlam; kelime tekrar listesine girer), sesli okuma ve okunan kelimenin vurgulanması | `src/ui/components/Reader.tsx`, `src/audio/speaker.ts` |
| Boşluk doldurma, kapalı kitap mini sınav | `src/ui/components/FillBlank.tsx`, `src/ui/lesson/QuizStep.tsx` |
| Aralıklı tekrar (yeni → öğreniliyor → bilinen; SM-2 benzeri, deterministik) | `src/core/srs.ts` |
| Kapsam hesabı: %95'in altındaki metin önerilmez | `src/core/coverage.ts` |
| Bildirim zamanlayıcı: seçilen saat, günde en fazla 1, sessiz saatler (Europe/Istanbul), tür bazlı açma/kapatma, 3 yok sayılan bildirimden sonra seyrekleşme | `src/core/scheduler.ts`, `server/notify.ts`, `api/cron/notify.ts` |
| Web push (VAPID), iPhone ana ekran izni, test bildirimi | `src/push/push.ts`, `src/sw/sw.js`, `api/push/test.ts` |
| İki cihaz senkronu: cihazda IndexedDB, Supabase'de "son yazan kazanır" | `src/data/`, `supabase/migrations/0001_init.sql` |
| Tek e-postayla giriş (bağlantı); iPhone ana ekran uygulaması için 6 haneli cihaz kodu | `api/login.ts`, `api/link/*`, `src/ui/screens/Login.tsx`, `src/ui/screens/DeviceLink.tsx` |
| Çevrimdışı mod: uygulama kabuğu ve bir sonraki dersin medyası önbellekte | `src/sw/sw.js`, `src/push/precache.ts` |
| Medya hattı: Nano Banana Pro (Gemini) / GPT Image, ElevenLabs v3 / gpt-4o-mini-tts / Gemini TTS; hash önbelleği; yer tutucu | `scripts/generate-media.ts`, `scripts/media/providers.ts` |
| İnceleme sayfası: görsel ve ses ızgarası, onayla / yeniden üret, sağlayıcı karşılaştırma | `/admin/review` → `src/ui/screens/AdminReview.tsx` |

## Mimari

```
iPhone / masaüstü (PWA)                     Vercel                       Supabase
┌──────────────────────────┐   /api/*   ┌───────────────────┐  SQL   ┌──────────────────────┐
│ React + IndexedDB        │──────────▶│ config, login,    │──────▶│ Postgres + RLS        │
│ service worker (push,    │            │ push/test,        │        │ Auth (e-posta kodu)   │
│ önbellek)                │◀── push ───│ cron/notify (web- │        │ pg_cron → 10 dakikada │
│ senkron: Supabase RPC    │──────────────────────────────────────▶│ bir /api/cron/notify  │
└──────────────────────────┘            └───────────────────┘        └──────────────────────┘
```

- **Yerel öncelikli:** her değişiklik önce cihaza yazılır, "kirli" işaretlenir, sonra gönderilir. Çakışmada istemci saatine göre yeni olan kazanır; sunucudaki `sync_*` fonksiyonları da bu kuralı uygular. Değişiklikler sunucu saatindeki `synced_at` imleciyle çekilir.
- **Tek kullanıcı:** `/api/login` yalnızca `ALLOWED_EMAIL` adresine kod gönderir. Kayıt kapalı tutulur, tüm tablolarda satır güvenliği (RLS) var.
- **Bildirim kararı saf bir fonksiyondur** (`decide`). Cron yalnızca durumu okur, karar verir ve gönderir.

## Testler

```
npm test      # 79 birim testi
npm run e2e   # 3 Playwright testi (iPhone 13 görünümü)
```

Birim testleri şunları kapsar:
- Tekrar motoru: doğru cevapta aralık uzar, yanlışta kısalır, ease alt sınırı.
- Zamanlayıcı: sessiz saatler, İstanbul saati, günlük sınır, 3 saat ara, seyrekleşme, uygulama açılınca sıfırlanma, mesaj tonu.
- Ders planlayıcı (4 günde 20 kelime) ve kapsam.
- İki cihaz senkronu.
- Gerçek Postgres (PGlite) üzerinde SQL şeması ve RLS.
- Medya adaptörlerinin istek ve yanıt işleme mantığı.

Uçtan uca test:
- 4 günlük dersi baştan sona tıklayarak tamamlar: sürükle-bırak, kelimeye dokunma, boşluk doldurma, sınav.
- 20 kelimenin tekrar kuyruğuna girdiğini doğrular.
- Ayarları, /admin/review sayfasını ve çevrimdışı açılışı dener.

## Sonraki aşama önerileri

1. **Ünite 2–N içerik hattı:** taslak metinleri yarı otomatik üretmek, kapsamı ve sözcük listesini otomatik doğrulamak. Hedef 3.000 sık kelime.
2. **Medyayı depodan çıkarmak:** binlerce görsel ve ses için Supabase Storage veya bir CDN; manifest yine hash'li kalır.
3. **FSRS'e geçiş:** `review_log` biriktikçe kişisel parametrelerle daha isabetli aralıklar.
4. **İlerleme ekranı:** bilinen kelime sayısının 3.000 hedefine göre durumu, okunabilir metin oranı.
5. **Okuma kütüphanesi:** kapsam ≥%95 olan metinleri sıralayan serbest okuma bölümü, daha uzun hikâyeler, yalnızca dinleme modu.
6. **Anlık senkron:** Supabase Realtime ile iki cihaz aynı anda açıkken anında güncelleme.
