# Okuma — kişisel İngilizce okuma uygulaması (v3)

Tek kullanıcılı, mobil öncelikli bir PWA. Hedef, kolaylaştırılmış İngilizce metinleri sözlüksüz okuyabilmek. Arayüz Türkçe, içerik İngilizce. İlerleme takvime değil **bitirilen derslere** bağlıdır; içerik NGSL 1.2 kelime listesi ve Tatoeba cümleleriyle kurulur; görseller ve sesler yalnızca ücretsiz ve açık kaynaklardan gelir.

Canlı adres: **https://okuma-iota.vercel.app** · Kurulum: **[docs/KURULUM.md](docs/KURULUM.md)**

## Neler var

| Özellik | Nerede |
| --- | --- |
| Sabit ders sırası. Ders bitince sıradaki hemen açılır: **Bir ders daha** / **Bugünlük bu kadar**. Gün atlamak hiçbir şeyi kilitlemez, borç biriktirmez. | `src/core/progress.ts`, `src/ui/screens/Lesson.tsx` |
| Günlük hedef 20/30/45 aktif dakika (gece yarısını geçen ders iki güne bölünür). Hedefe ulaşılan gün seriye sayılır. Kaçan gün seriyi sıfırlamaz, dondurur. | `src/core/progress.ts`, `src/ui/screens/Today.tsx` |
| **Ara ver**: süre sınırı yok, bildirim gitmez. Dönüşte tekrarlar günde en fazla 40 kart. | `src/core/scheduler.ts`, `src/core/progress.ts` |
| Ders başına 10 yeni kelime (6–15 ayarlanabilir), NGSL sırasıyla. | `src/core/course.ts` |
| Süreye göre ders motoru: ısınma tekrarı → 4'lü yeni kelime grupları → zorlaşan alıştırmalar → 60 sn hızlı tur. Aynı tür üst üste en fazla 2 kez. | `src/core/session.ts` |
| Alıştırmalar: dilbilgisi kartı, resim↔kelime, sürükle-bırak eşleştirme, dinle→seç, dikte (toleranslı), boşluk doldurma, cümle kurma (Türkçesi görünür), okuma + 3 soru, İng→Tr / Tr→İng, mini sahne, 60 sn hızlı tur | `src/ui/exercises/` |
| Dokunarak okuma, sesli okuma ve okunan kelimenin vurgulanması | `src/ui/components/Reader.tsx`, `src/audio/speaker.ts` |
| İçerik: 5 ünite, 500 kelime. NGSL 1.2 sırası; Ünite 2'den itibaren her üniteye NGSL'nin ilk 500'ünde olmayan 22–23 günlük kelime (sayılar, aile, günler, yemekler, renkler…) serpiştirilir. 5535 Tatoeba EN–TR çifti (anadili konuşanlar, sahip bilgisiyle), 140 özgün cümle, 28 kısa metin. Her kelimeye öğretildiği derste en az 3 cümle; cümlelerdeki kelimelerin ≥%95'i bilinir. | `content/`, `scripts/content/lexicon.ts`, `scripts/build-content.ts` |
| Kademeli okuma: Ünite 1 olduğu gibi kalır; Ünite 2'den itibaren cümleler ünite ünite uzar (en çok 9 → 10 → 12 → 14 → 16 kelime), metinler 9–10 cümleden ~15 cümleye çıkar, cümle kurma taşları artar. Bir cümle ya da metin, öğrencinin ünitesine gelmeden çıkmaz; okunmamış metinler önce gelir. | `scripts/build-content.ts`, `src/core/session.ts` |
| Kısa dilbilgisi kartları (30 konu: am/is/are, a/an, olumsuz, soru, geçmiş zaman…). Kart, konunun kelimesi öğretildiği derste o kelimenin hemen ardından gelir; ders başına en fazla 2. Atlanan konular sonraki derslerde ısınmadan sonra telafi edilir. Hepsi Ayarlar → **Dilbilgisi notları** ekranında. | `content/grammar.json`, `src/core/progress.ts`, `src/ui/exercises/GrammarCard.tsx` |
| Görseller: Pexels, Pixabay (ücretsiz anahtarla), anahtarsız Openverse ve Wikimedia Commons. Kelime başına 5 aday, 4:3, ≤800 px, kendi sunucumuzda. Soyut kelimeler emoji ya da cümle + sesle öğretilir. | `scripts/fetch-images.ts`, `scripts/media/stock.ts` |
| `/admin/review`: 5 adaydan birini seç ya da "görsel yok" de. Seçim hesaba kaydedilir, iki cihazda aynı resim görünür. | `src/ui/screens/AdminReview.tsx`, `media_choices` tablosu |
| Ayarlar → **Görsel kaynakları** ve **Kaynaklar** (NGSL, Tatoeba sahipleri, fotoğrafçılar, lisanslar) | `src/ui/screens/Sources.tsx` |
| Ses: Kokoro-82M (Apache 2.0) yerel üretim. Klibi olmayan yerde cihazın sesi (speechSynthesis) kullanılır. | `scripts/generate-audio.ts` |
| Aralıklı tekrar, bildirimler (sessiz saatler, seyrekleşme), web push, iki cihaz senkronu, cihaz kodu ile giriş | `src/core/srs.ts`, `server/`, `src/data/` |
| Çevrimdışı: uygulama kabuğu ve sıradaki dersin medyası. Medya önbelleği sürümlüdür; yeni sürümde kullanılmayan dosyalar silinir. | `src/sw/sw.js`, `scripts/vite-sw-plugin.ts` |

## Betikler

```
npm run import-tatoeba     # Tatoeba dökümlerinden EN–TR alt kümesi (TATOEBA_DIR)
npm run build-content      # NGSL + cümleler + metinler → content/build/course.json
npm run fetch-images       # ücretsiz stok fotoğraflar → public/media/img + content/media/credits.json
npm run generate-audio     # Kokoro-82M ile sesler (kelime, cümle, metin, dilbilgisi örnekleri) → public/media/audio
npm run validate-content   # kapsam, cümle sayısı, lisans alanları, eksik medya → content/build/validation.md
npm run deploy -- --update # veritabanı geçişleri + uygulamayı yeniden dağıt
```

`PIXABAY_API_KEY` ücretsizdir ve tanımlıdır. `PEXELS_API_KEY` isteğe bağlıdır; Pexels şu an yeni anahtar vermiyor. Anahtar yoksa betik ne eksik olduğunu yazar ve Openverse ile Wikimedia Commons'u kullanır. Başka bir ücretli servis kullanılmaz.

## Mimari

```
iPhone / masaüstü (PWA)                     Vercel                       Supabase
┌──────────────────────────┐   /api/*   ┌───────────────────┐  SQL   ┌──────────────────────┐
│ React + IndexedDB        │──────────▶│ config, login,    │──────▶│ Postgres + RLS        │
│ service worker (push,    │            │ push/test,        │        │ Auth (e-posta kodu)   │
│ sürümlü önbellek)        │◀── push ───│ cron/notify (web- │        │ pg_cron → 10 dakikada │
│ senkron: Supabase RPC    │──────────────────────────────────────▶│ bir /api/cron/notify  │
└──────────────────────────┘            └───────────────────┘        └──────────────────────┘
```

- **Yerel öncelikli:** her değişiklik önce cihaza yazılır, sonra gönderilir. Çakışmada yeni olan kazanır (`sync_cards`, `sync_lessons`, `sync_settings`, `sync_media_choices`).
- **İlerleme sunucuda:** `lesson_log` her dersin sıra numarasını, bitiş zamanını ve gün gün aktif süresini tutar. Sıradaki ders = son bitirilen + 1 (yarım kalan varsa o).
- **Tek kullanıcı:** `/api/login` yalnızca `ALLOWED_EMAIL` adresine kod gönderir; tüm tablolarda RLS var.

## Testler

```
npm test      # birim testleri (Vitest)
npm run e2e   # Playwright, iPhone 13 görünümü
```

- Ders sırası: "bir ders daha" zinciri, gün atlama, yarım dersin sürdürülmesi, gece yarısı geçişi, ara verme ve dönüş, günlük 40 tekrar sınırı, seri dondurma.
- Ders motoru: 30 dakikalık simülasyonda ≥8 alıştırma kategorisi, aynı tür en fazla 2 kez üst üste, zorluk artışı, hızlı turla bitiş; 20/45 dk ve 6/15 kelime; ünitesine gelmemiş cümle ve metnin çıkmaması; dilbilgisi kartı ve telafi sırası.
- İçerik doğrulama, stok fotoğraf adaptörleri (lisans süzme, Pixabay 24 saat önbellek), senkron, SQL geçişleri (PGlite), bildirim zamanlayıcı.
- Uçtan uca: üç ders üst üste (dilbilgisi kartıyla), gün atlayıp yarım dersi sürdürme, ayarlar, dilbilgisi notları ve kaynak ekranları, çevrimdışı açılış.
