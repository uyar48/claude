# Devam: canlıya alma (yeni oturum için not)

Aşama 1 canlıda: https://okuma-iota.vercel.app

- **Supabase:** proje `okuma` (Frankfurt), şema 0001 + 0002, kayıt kapalı, pg_cron her 10 dakikada bir.
- **Vercel:** proje `okuma`, tüm sunucu değişkenleri tanımlı.
- **Canlıda doğrulandı:**
  - `/api/config`, cron (gizli anahtarla 200, anahtarsız 401)
  - yalnızca `ALLOWED_EMAIL` ile giriş
  - cihaz kodu: tek kullanım, 5 yanlış denemede iptal
  - iki tarayıcı arasında senkron
- **Kullanıcı doğruladı:** iPhone'da test bildirimi geldi.
- **Ses: tamam.** Kullanıcı v4 · Bella / Chris seçti. 81 klip üretildi; 21 metin cümlesinin hepsinde ElevenLabs kelime zaman damgası var. Bu ses ve model artık varsayılan.
- **Görsel: faturalandırma bekleniyor.**
  - Imagen 4 Ultra artık Gemini API'de yok (404).
  - Yerine `gemini-pro` (`gemini-3-pro-image`) ve `gemini-flash` (`gemini-3.1-flash-image`) sağlayıcıları eklendi.
  - `IMAGE_API_KEY_GOOGLE` tanımlı, ama anahtarın projesi ücretsiz katmanda; görsel modellerinin kotası 0 (429).
  - Kullanıcı AI Studio'da faturalandırmayı açınca sırasıyla:
    1. `npm run media -- --compare-images gemini-pro,gemini-flash --words 10`
    2. Commit, ardından `npm run deploy -- --app-only`.
    3. Kullanıcıya `/admin/review` adresini gönder ve seçtir.
    4. `IMAGE_PROVIDER=<seçim> npm run media -- --only images`, ardından yeniden dağıt.
