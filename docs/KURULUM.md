# Kurulum (yaklaşık 20 dakika)

> **Otomatik kurulum:** Ortamda `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN` ve `ALLOWED_EMAIL` tanımlıysa `npm run deploy`, aşağıdaki 1–3. adımların hepsini tek seferde yapar (tekrar çalıştırılabilir). Bu proje bu yolla kuruldu: https://okuma-iota.vercel.app


Uygulama anahtar olmadan da çalışır: ilerleme yalnızca o cihazda tutulur. Senkron, giriş ve bildirimler için aşağıdaki iki ücretsiz hesap gerekir. Görseller ve sesler ücretsiz ve açık kaynaklardan gelir.

| Ne | Nerede | Neden |
| --- | --- | --- |
| Veritabanı + giriş | Supabase (ücretsiz plan) | İki cihaz arası senkron, e-posta ile giriş |
| Barındırma | Vercel (Hobby, ücretsiz) | Herkese açık HTTPS adresi, sunucu fonksiyonları |
| Görsel anahtarı (isteğe bağlı, ücretsiz) | Pexels, Pixabay | Daha çok ve daha iyi stok fotoğraf |

## 1. Supabase

1. supabase.com → **New project**. Bölge olarak **Frankfurt (eu-central-1)** seç; İstanbul'a en yakın bölge bu.
2. **SQL Editor** → `supabase/migrations/0001_init.sql` dosyasının içeriğini yapıştır → **Run**.
3. **Authentication → Sign In / Providers → Email**: açık kalsın. **Allow new users to sign up** seçeneğini **kapat**. Kullanıcıyı uygulama kendisi oluşturur; yalnızca `ALLOWED_EMAIL` adresine izin verilir.
4. **Authentication → URL Configuration**:
   - **Site URL**: Vercel adresin, örneğin `https://okuma.vercel.app`.
   - **Redirect URLs**: `https://okuma.vercel.app/**` ekle.
5. **Project Settings → API**: `Project URL`, `anon` anahtarı ve `service_role` anahtarını not al. `service_role` anahtarı gizlidir; yalnızca Vercel'e girilir.

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

## 4. iPhone'a ekleme, giriş ve bildirim izni (iOS 18)

iPhone'da ana ekrana eklenen uygulamanın depolaması Safari'den ayrıdır. E-postadaki bağlantı her zaman Safari'de açılır. Bu yüzden ana ekran uygulaması **6 haneli cihaz koduyla** girer.

1. iPhone'da **Safari** ile uygulama adresini aç (ör. `https://okuma-iota.vercel.app`).
2. Alttaki **Paylaş** düğmesine (kare ve yukarı ok) dokun → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekrandaki **Okuma** simgesinden aç. Safari sekmesinden açma; iPhone bildirimleri yalnızca ana ekran uygulamasında çalışır.
4. E-postanı yaz → **Giriş bağlantısı gönder**.
5. Mail'de gelen e-postadaki **Sign in** bağlantısına dokun. Safari açılır, giriş yapar ve **6 haneli bir kod** gösterir.
6. Ana ekrandaki Okuma'ya dön → **Cihaz kodu** alanına kodu yaz → **Kodla giriş yap**. Kod 10 dakika geçerlidir ve tek kullanımlıktır.
7. **Ayarlar** (sağ üstteki dişli) → **Bildirimlere izin ver** → iOS penceresinde **İzin Ver**.
8. **Test bildirimi gönder**: bildirim birkaç saniye içinde gelir; ekran kilitliyken de gelir.
9. Sonradan değiştirmek için: iPhone **Ayarlar → Bildirimler → Okuma**.

Giriş yapılmış herhangi bir cihazda **Ayarlar → Başka cihazı bağla** da bir kod verir. Örneğin bilgisayardan telefona bu yolla geçebilirsin.

> Supabase'in ücretsiz planı, varsayılan e-posta sağlayıcısıyla e-posta şablonunun değiştirilmesine izin vermez. Bu yüzden giriş e-postası İngilizce ("Your sign-in link") gelir ve saatte en fazla 2 e-posta gönderilebilir. Kendi SMTP sağlayıcını (ör. Resend) tanımlarsan ikisi de değiştirilebilir.

## 5. Bilgisayar (masaüstü tarayıcı)

1. Chrome, Edge, Firefox veya Safari ile aynı adresi aç. Giriş için bağlantıyı ya da kodu kullan.
2. **Ayarlar → Bildirimlere izin ver → Test bildirimi gönder**.
3. macOS'ta **Sistem Ayarları → Bildirimler** altında tarayıcının bildirimlerinin açık olduğundan emin ol.
4. Aynı hesapla giriş yapıldığında iki cihazda aynı ilerleme görünür. Senkron uygulama açılınca, öne gelince ve her dakika çalışır.

## 6. Görseller ve sesler (ücretsiz)

Üretim tek seferliktir; uygulama çalışırken üretim yapılmaz. Dosyalar depoya işlenir ve uygulamayla birlikte dağıtılır.

**Görseller — `npm run fetch-images`:**

- Somut kelimeler için kelime başına 5 aday fotoğraf indirir. Fotoğraflar 4:3 kırpılır, en fazla 800 px olur ve `public/media/img/` klasörüne kaydedilir. Kaynak, yazar ve lisans `content/media/credits.json` dosyasına yazılır.
- Kaynak sırası:
  1. Pexels (`PEXELS_API_KEY`; isteğe bağlı — Pexels şu an yeni API anahtarı vermiyor)
  2. Pixabay (`PIXABAY_API_KEY`, ücretsiz: https://pixabay.com/api/docs/). Fotoğraflar indirilip kendi sunucumuzda tutulur, arama sonuçları 24 saat önbellekte kalır.
  3. Anahtar gerektirmeyen Openverse ve Wikimedia Commons. ND (türev yasak) lisanslar ve uygunsuz başlıklar elenir.
- Anahtarlar ortam değişkeni olarak eklenir; bu ortamda **ortamı düzenle → ortam değişkenleri**, GitHub'da **Settings → Secrets and variables → Actions**. Anahtarı sohbete ya da koda yapıştırma.
- 5 adayı zaten inmiş kelimeler atlanır. `--force` yeniden arar, `--prune` kullanılmayan dosyaları siler.
- Sonra uygulamada **/admin/review** sayfasını aç. Her kelime için bir fotoğraf seç ya da "Görsel yok" de. Seçim hesabına kaydedilir; iki cihaz da aynı resmi gösterir.

**Sesler — `npm run generate-audio`:**

- Kokoro-82M (Apache 2.0) modelini yerelde çalıştırır. Anahtar ya da ücret yoktur. İlk çalıştırmada model Hugging Face'ten iner (~90 MB).
- Kelimeleri, metin cümlelerini ve ders cümlelerini MP3 olarak `public/media/audio/` klasörüne yazar. `ffmpeg` gerekir.
- Metni değişmeyen klipler yeniden üretilmez.
- Klibi olmayan yerde uygulama cihazın kendi sesini (speechSynthesis) kullanır.
- Okunan kelimenin vurgusu, varsa sağlayıcının zaman damgalarıyla, yoksa kelime uzunluğuna göre tahminle yapılır.

**Kontrol — `npm run validate-content`:** kapsam, kelime başına cümle sayısı, lisans alanları, eksik görsel ve ses. Rapor: `content/build/validation.md`.

**GitHub'dan:** **Actions → Medya → Run workflow** üç betiği sırayla çalıştırır ve sonucu depoya işler.

Yeni medyadan sonra: `npm run deploy -- --app-only`. Veritabanı değiştiyse: `npm run deploy -- --update`.

## Yerel geliştirme

```bash
npm install
npm run dev          # http://localhost:5173 (api/ fonksiyonları da çalışır; .env dosyasını okur)
npm test             # birim testleri (ders sırası, ders motoru, tekrar, zamanlayıcı, senkron, SQL, içerik)
npm run e2e          # Playwright: ders zinciri, gün atlama, ayarlar, kaynaklar, çevrimdışı
```
