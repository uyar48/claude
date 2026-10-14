# Kurulum (yaklaşık 20 dakika)

Uygulama anahtar olmadan da çalışır: ilerleme yalnızca o cihazda tutulur, görseller yer tutucudur, sesler tarayıcının sesiyle okunur. Senkron, giriş ve bildirimler için aşağıdaki üç hesap gerekir.

| Ne | Nerede | Neden |
| --- | --- | --- |
| Veritabanı + giriş | Supabase (ücretsiz plan) | İki cihaz arası senkron, e-posta ile giriş |
| Barındırma | Vercel (Hobby, ücretsiz) | Herkese açık HTTPS adresi, sunucu fonksiyonları |
| Görsel / ses anahtarı | Google AI Studio, OpenAI, ElevenLabs | Fotoğraf gerçekliğinde görsel, doğal ses |

## 1. Supabase

1. supabase.com → **New project**. Bölge olarak **Frankfurt (eu-central-1)** seç; İstanbul'a en yakın bölge bu.
2. **SQL Editor** → `supabase/migrations/0001_init.sql` dosyasının içeriğini yapıştır → **Run**.
3. **Authentication → Sign In / Providers → Email**: açık kalsın. **Allow new users to sign up** seçeneğini **kapat**. Kullanıcıyı uygulama kendisi oluşturur; yalnızca `ALLOWED_EMAIL` adresine izin verilir.
4. **Authentication → Emails → Magic Link** şablonunu şununla değiştir. Kod satırı önemli: iPhone ana ekran uygulaması e-postadaki bağlantıyı açamaz, 6 haneli kodla girer.
   ```html
   <h2>Okuma'ya giriş</h2>
   <p>Giriş kodun: <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>Ya da bu cihazda: <a href="{{ .ConfirmationURL }}">giriş yap</a></p>
   ```
5. **Authentication → URL Configuration**:
   - **Site URL**: Vercel adresin, örneğin `https://okuma.vercel.app`.
   - **Redirect URLs**: `https://okuma.vercel.app/**` ekle.
6. **Project Settings → API**: `Project URL`, `anon` anahtarı ve `service_role` anahtarını not al. `service_role` anahtarı gizlidir; yalnızca Vercel'e girilir.

## 2. Vercel

1. vercel.com → **Add New → Project** → GitHub'daki `uyar48/claude` deposunu içe aktar. Framework `Vite` olarak otomatik gelir.
2. **Settings → Environment Variables** bölümüne şunları ekle (Production ve Preview için):

   | Değişken | Değer |
   | --- | --- |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | anon anahtarı |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role anahtarı |
   | `ALLOWED_EMAIL` | giriş yapacak tek e-posta |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npm run vapid` çıktısı (bir kez üret, sakla) |
   | `VAPID_SUBJECT` | `mailto:` + kendi e-postan |
   | `CRON_SECRET` | rastgele uzun bir metin (ör. `openssl rand -hex 32`) |

3. **Settings → Git → Production Branch**: şimdilik `claude/new-session-b5nvn7`. Böylece sabit adres (`https://<proje>.vercel.app`) bu dalı gösterir. PWA, bildirim aboneliği ve giriş bağlantısı adrese bağlıdır; her dağıtımda değişen önizleme adresleri yerine bu sabit adresi kullan.
4. Önizleme adresi kullanacaksan **Settings → Deployment Protection → Vercel Authentication** seçeneğini kapat. Yoksa iPhone ve zamanlayıcı Vercel giriş sayfasına takılır.
5. **Deploy**. Uygulamada **Ayarlar → Kurulum durumu** bölümü eksik değişken kalırsa listeler.

## 3. Bildirim zamanlayıcısı (Supabase pg_cron)

Vercel'in ücretsiz cron'u günde yalnızca bir kez çalışır. Bu yüzden zamanlayıcı Supabase'de kurulur.

1. Supabase → **Database → Extensions**: `pg_cron` ve `pg_net` eklentilerini aç.
2. `supabase/cron.sql` dosyasında `APP_URL` (ör. `okuma.vercel.app`) ve `CRON_SECRET` değerlerini değiştir, ardından SQL Editor'da çalıştır.
3. Zamanlayıcı her 10 dakikada bir `/api/cron/notify` adresini çağırır. Sunucu kurallara göre bildirim gönderip göndermeyeceğine karar verir:
   - Seçilen saatte gönderir, her türden günde en fazla 1 tane.
   - Sessiz saatlerde göndermez.
   - Üst üste 3 bildirim açılmazsa sıklığı düşürür.

## 4. iPhone'a ekleme ve bildirim izni (iOS 18)

1. iPhone'da **Safari** ile `https://<proje>.vercel.app` adresini aç.
2. Alttaki **Paylaş** düğmesine (kare ve yukarı ok) dokun → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekrandaki **Okuma** simgesinden aç. Safari sekmesinden değil; iPhone bildirimleri yalnızca ana ekran uygulamasında çalışır.
4. E-postanı yaz → **Giriş bağlantısı gönder** → e-postadaki **6 haneli kodu** uygulamaya yaz.
5. **Ayarlar** (sağ üstteki dişli) → **Bildirimlere izin ver** → iOS penceresinde **İzin Ver**.
6. **Test bildirimi gönder**: bildirim birkaç saniye içinde gelir; ekran kilitliyken de gelir.
7. Sonradan değiştirmek için: iPhone **Ayarlar → Bildirimler → Okuma**.

## 5. Bilgisayar (masaüstü tarayıcı)

1. Chrome, Edge, Firefox veya Safari ile aynı adresi aç. Giriş için bağlantıyı ya da kodu kullan.
2. **Ayarlar → Bildirimlere izin ver → Test bildirimi gönder**.
3. macOS'ta **Sistem Ayarları → Bildirimler** altında tarayıcının bildirimlerinin açık olduğundan emin ol.
4. Aynı hesapla giriş yapıldığında iki cihazda aynı ilerleme görünür. Senkron uygulama açılınca, öne gelince ve her dakika çalışır.

## 6. Görsel ve ses üretimi

Üretim tek seferliktir; uygulama çalışırken üretim yapılmaz. Her çıktı içerik hash'iyle kaydedilir, aynı girdi tekrar üretilmez.

**Seçenek A — GitHub'dan (bilgisayar gerekmez):**

1. Depo → **Settings → Secrets and variables → Actions** bölümüne anahtarları ekle:
   - `IMAGE_API_KEY_GOOGLE`: Google AI Studio anahtarı, Imagen 4 Ultra için
   - `IMAGE_API_KEY_OPENAI`: OpenAI anahtarı, GPT Image için
   - `TTS_API_KEY_ELEVENLABS`, `TTS_API_KEY_OPENAI`, `TTS_API_KEY_GOOGLE`: hangileri varsa
2. **Actions → Medya üret → Run workflow**:
   1. `mode = compare-images`: ilk 10 kelime iki sağlayıcıyla üretilir.
   2. `mode = compare-tts`: 3 kelime ve 1 cümle her ses sağlayıcısıyla üretilir.
3. Uygulamada **/admin/review** sayfasını aç. Görsel ve ses karşılaştırmasında beğendiğini seç, istemediklerini "Yeniden üret" diye işaretle, **Dışa aktar** metnini kopyala.
4. **Medya üret** iş akışını `mode = all` ile, seçtiğin sağlayıcılarla çalıştır. Kopyaladığın metni `review` alanına yapıştır. Sonuç depoya işlenir ve Vercel yeniden dağıtır.

**Seçenek B — kendi bilgisayarında:**

```bash
npm install
IMAGE_API_KEY_GOOGLE=… IMAGE_API_KEY_OPENAI=… npm run media -- --compare-images google,openai --words 10
TTS_API_KEY_ELEVENLABS=… TTS_API_KEY_OPENAI=… npm run media -- --compare-tts elevenlabs,openai --words 3
# seçimden sonra:
IMAGE_PROVIDER=google IMAGE_API_KEY=… TTS_PROVIDER=elevenlabs TTS_API_KEY=… npm run media
```

Anahtar yoksa betik hangi anahtarın eksik olduğunu yazar ve yer tutucuyla devam eder. Uygulama da **Ayarlar → Kurulum durumu** bölümünde bunu gösterir.

Model adları ortam değişkeniyle değiştirilebilir:

| Sağlayıcı | Değişken | Varsayılan |
| --- | --- | --- |
| Google görsel | `IMAGE_MODEL_GOOGLE` | `imagen-4.0-ultra-generate-001` |
| OpenAI görsel | `IMAGE_MODEL_OPENAI` | `gpt-image-2` |
| ElevenLabs ses | `TTS_MODEL_ELEVENLABS` | `eleven_v3` |
| OpenAI ses | `TTS_MODEL_OPENAI` | `gpt-4o-mini-tts` |
| Google ses | `TTS_MODEL_GOOGLE` | `gemini-2.5-flash-preview-tts` |

Sesleri de değiştirebilirsin: `ELEVENLABS_VOICE_FEMALE/MALE`, `OPENAI_VOICE_FEMALE/MALE`, `GOOGLE_VOICE_FEMALE/MALE`.

**Okunan kelime vurgusu** üç kaynaktan sırayla beslenir:

1. Sağlayıcının kelime zaman damgaları (ElevenLabs).
2. Zorlamalı hizalama: konuşmadan metne çevirinin kelime zamanları (OpenAI).
3. O da yoksa, kelime uzunluğuna göre yaklaşık zamanlama.

## Yerel geliştirme

```bash
npm install
npm run dev          # http://localhost:5173 (api/ fonksiyonları da çalışır; .env dosyasını okur)
npm test             # birim testleri (tekrar motoru, zamanlayıcı, senkron, SQL, adaptörler)
npm run e2e          # Playwright: 4 günlük ders akışı, ayarlar, çevrimdışı
```
