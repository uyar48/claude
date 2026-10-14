# Devam: canlıya alma (yeni oturum için not)

Aşama 1 canlıda: https://okuma-iota.vercel.app

- **Supabase:** proje `okuma` (Frankfurt), şema 0001 + 0002, kayıt kapalı, pg_cron her 10 dakikada bir.
- **Vercel:** proje `okuma`, tüm sunucu değişkenleri tanımlı.
- **Canlıda doğrulandı:**
  - `/api/config`, cron (gizli anahtarla 200, anahtarsız 401)
  - yalnızca `ALLOWED_EMAIL` ile giriş
  - cihaz kodu: tek kullanım, 5 yanlış denemede iptal
  - iki tarayıcı arasında senkron
- **Kalan işler:**
  - gerçek cihazda bildirim testi
  - gerçek görsel ve ses üretimi (anahtarlar henüz yok)

## Ortamda olması gerekenler

Bulut ortamı ayarları → Edit:

- **Network access** şu adreslere izin vermeli: `api.vercel.com`, `vercel.com`, `api.supabase.com`, `*.supabase.co`, `api.openai.com`, `api.elevenlabs.io`, `generativelanguage.googleapis.com`.
- **Ortam değişkenleri** (yalnızca ayarlardan girilir, sohbete yapıştırılmaz):

| Değişken | Nereden |
| --- | --- |
| `VERCEL_TOKEN` | vercel.com/account/tokens |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `ALLOWED_EMAIL` | uygulamaya giriş yapacak e-posta |
| `IMAGE_API_KEY_GOOGLE` | aistudio.google.com/apikey (Imagen ücretli katmanda çalışır) |
| `IMAGE_API_KEY_OPENAI`, `TTS_API_KEY_OPENAI` | platform.openai.com/api-keys (aynı anahtar olabilir) |
| `TTS_API_KEY_ELEVENLABS` | elevenlabs.io → Developers → API keys |

## Adımlar

1. `npm ci`
2. `npm run deploy`: Supabase projesi (Frankfurt), şema, giriş ayarları, Vercel projesi, ortam değişkenleri, üretim dağıtımı ve pg_cron. Betik tekrar çalıştırılabilir; oluşturulan gizli değerler `.deploy/state.json` dosyasında durur (git'e girmez).
3. `npm run media -- --compare-images google,openai --words 10` ve `npm run media -- --compare-tts elevenlabs,openai,google --words 3`. Sonucu commit et, yeniden dağıt, `/admin/review` adresini kullanıcıya gönder ve seçtir.
4. Seçimden sonra `IMAGE_PROVIDER=… TTS_PROVIDER=… npm run media`, ardından commit ve yeniden dağıtım (`npm run deploy`).
5. Kullanıcıya üretim adresini ver; iPhone adımları `docs/KURULUM.md` bölüm 4'te.
