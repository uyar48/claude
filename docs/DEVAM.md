# Devam: durum notu (yeni oturum için)

Canlı adres: https://okuma-iota.vercel.app · Dal: `claude/new-session-b5nvn7`

## v2 (BRIEF-v2) — canlıda (16 Ekim 2026)

- Geçiş 0003 canlı veritabanına uygulandı. Eski 3 ders 1–3 numarasını ve aktif sürelerini aldı; sıradaki ders 4.
- 21 somut kelimenin her birine 5 Pixabay adayı indi. Varsayılan fotoğraflar gözle seçildi.
- 1135 sesin hepsi hazır (Kokoro + korunan ElevenLabs klipleri). `validate-content` hatasız.
- Testler: 97 birim, 3 uçtan uca. Canlıda kontrol edildi: giriş sayfası, `/admin/review` (105 aday), medya dosyaları, `/api/cron/notify` 200.
- Pixabay fotoğrafları yardımcı bir oturumda indirildi; anahtar bu oturuma görünmüyordu (`claude/pixabay-images` dalı birleştirildi).

## Ayrıntılar

- **İlerleme bitirilen derslere bağlı.**
  - Kodu: `src/core/progress.ts`, `src/core/session.ts`, `src/ui/screens/Lesson.tsx`.
  - Sunucuda `lesson_log` tablosu `number`, `active_ms` ve `day_ms` alanlarını tutuyor (migration 0003). `media_choices` tablosu `/admin/review` seçimlerini saklıyor.
  - Eski dersler sıra numarası alır. Eski kurulumdan kalan "15 dk" ayarı 20 dk hedef olur, `newPerDay` ise ders başına 10 kelime olur. Bu dönüşüm hem SQL'de hem istemcide aynı kuralla yapılır.
- **İçerik.**
  - Kaynaklar `content/ngsl/` (NGSL 1.2) ve `content/tatoeba/` (EN–TR alt kümesi, reddedilenler `rejected.json`).
  - Ünite 1 dosyaları `content/units/unit-01.*.json`; derlenmiş hali `content/build/course.json`.
  - Yeniden üretmek için:
    1. `npm run import-tatoeba` (`TATOEBA_DIR` ham dökümleri gösterir)
    2. `npm run build-content`
    3. `npm run validate-content`
- **Görseller.**
  - `npm run fetch-images`: önce Pexels ve Pixabay (anahtar varsa), sonra Openverse ve Wikimedia Commons.
  - Openverse anonim sınırı dakikada 20 istek; betik buna göre bekler. Wikimedia bu ortamdan sık sık 429 döner, betik o adayı atlar.
- **Ses.**
  - `npm run generate-audio` sesleri Kokoro-82M ile yerelde üretir (af_heart / am_michael).
  - İlk 20 kelimenin ve t1–t5 metinlerinin ElevenLabs klipleri metinleri değişmediği için korunur.
- **Dağıtım.**
  - `npm run deploy -- --update` önce geçişleri (idempotent), sonra uygulamayı dağıtır.
  - Yalnız uygulama için: `--app-only`.

## Bekleyen

- `PIXABAY_API_KEY` ortamda tanımlı (yeni oturumlarda görünür). Pexels yeni anahtar vermediği için `PEXELS_API_KEY` yok; bu bilinçli bir durum.
- Fotoğrafları yenilemek için:
  1. `npm run fetch-images -- --force --prune`
  2. Commit, ardından `npm run deploy -- --app-only`
  3. Kullanıcıya `/admin/review` adresini gönder.
- Ünite 2 ve sonrası: `content/units/unit-02.*.json` ekle, `build-content` ünite listesini okur (UNIT_SIZE = 100).
