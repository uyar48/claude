# Devam: durum notu (yeni oturum için)

Canlı adres: https://okuma-iota.vercel.app · Dal: `claude/new-session-b5nvn7`

## v4 — yazarak cevaplama, performansa göre zorluk, ilerleme ve ünite testi (17 Ekim 2026)

- **Yazma alıştırmaları** (`type-blank`, `dictate-sentence`, `write-sentence`; zorluk 3):
  - Yalnız önceki derslerde öğrenilmiş kelimelerle (`writingOk`). Ders kötü gidiyorsa (`pace` = easier) hiç gelmez.
  - Zor kısım açıldığında her 3 alıştırmada bir yazma sırası var (iyi giderken 2'de bir), aday kelimeler `writingCandidates`.
  - Cümle uzunluğu sınırları: dikte `[5, 6, 7, 8, 9]`, Türkçeden yazma `[0, 6, 7, 8, 9]` kelime (Ünite 1'de Türkçeden yazma yok).
  - Kontrol `src/core/answer.ts`: kelime düzeyinde düzenleme mesafesi, kısaltma açma, 4+ harfte 1, 8+ harfte 2 yazım hatası, Türkçeden yazarken he/she/it eşdeğer.
- **Hız (`pace`)**:
  - Son 10 puanlı cevap; 5'ten azsa önceki 3 dersin oranı (`recentAccuracy`, `lesson_log.reviewed/correct`) tamamlar.
  - ≥%85 `harder`: zor kısım %20'de açılır, ısınma Türkçe→İngilizce ve dinlemeyle olur, en kolay türler (resim seçme, İng→Tr) uygulamada düşer.
  - <%60 `easier`: zor kısım %70'te açılır, zor tür tercihi yok, yazma yok.
- **İlerleme ekranı** `/ilerleme`:
  - Metin kapsamı = bilinen kelimelerin NGSL U değerleri toplamı / 1.000.000 (`course.freq`, `build-content` NGSL_1.2_stats.csv'den yazar). 100 kelimede ~%54, 500'de ~%69.
  - Ayrıca okunabilir kurs metinleri, ünite ilerlemesi ve son 8 dersin doğru oranı.
- **Ünite testi** `/test/:unit`:
  - Ünitenin bütün kelimeleri tanıtılınca açılır; Bugün ekranı bir kez önerir.
  - 20 soru, kolaydan zora, en fazla ~%30 yazılı (`unitTestExercises`).
  - Sonuç `settings.unitTests` içinde (senkronlanan jsonb, geçiş gerekmedi). Yanlışlar `reviewSoon` ile tekrara alınır (SRS cezası yok).
  - Test süresi günlük hedefe sayılmaz.

## v3 — Ünite 2–5, kademeli okuma, dilbilgisi kartları (16 Ekim 2026)

- **Kelimeler.** 500 kelime, 5 ünite (`UNIT_SIZE = 100`). Ünite 1 hiç değişmedi.
  - NGSL'nin ilk 500'ünde sayılar, aile, günler, renkler gibi temel kelimeler yok. Bu yüzden `scripts/content/lexicon.ts` içindeki `EVERYDAY` listesi her üniteye 22–23 günlük kelime ekliyor (Ünite 2'den başlayarak, NGSL kelimelerinin arasına eşit aralıkla).
  - Bu ekleme bazı NGSL kelimelerini 500'ün dışına itti (ör. `please`). O kelimeler `content/units/glosses.json` havuzunda sonraki üniteyi bekliyor.
  - Ünite dosyaları (`unit-02..05.words.json`) bu havuzdan sırayla üretilir.
- **Kademeli okuma.**
  - Tatoeba cümlesinin ünitesi = max(en yeni kelimesinin ünitesi, uzunluk ünitesi). Uzunluk sınırları `MAX_WORDS_BY_UNIT = [9, 10, 12, 14, 16]`.
  - Ünite 1 en kısa cümleleri tutar. Sonraki ünitelerde seçim izin verilen uzunluklara yayılır.
  - Metinler t9–t28, ünite başına 5. Ünite 2'de 9–10 cümle, Ünite 5'te ~15 cümle.
  - Oturum `learnerUnit` ile öğrencinin ünitesini bulur. Daha ileri ünitenin cümlesi ya da metni çıkmaz; okunmamış metin önce gelir.
- **Dilbilgisi kartları.**
  - `content/grammar.json` içinde 31 konu var; 30'u derlenir (`g-could` ancak `please` bir üniteye girince gelir).
  - Kart, tetik kelimesinin tanıtımından hemen sonra gelir. Tetik kelimesi zaten öğrenilmişse ısınmadan sonra telafi olarak gelir.
  - Ders başına en fazla 2 kart (`GRAMMAR_PER_LESSON`). Görülenler `settings.grammarSeen` ile senkronlanır.
  - Örnek sesleri `g:<id>:<i>` anahtarıyla üretilir.
- **Görseller.**
  - Ünite 2–5'in 89 somut kelimesi için Pixabay adayları yardımcı oturumda indi (`claude/pixabay-images-2` birleştirildi).
  - `father` bu oturumda indirildi. Varsayılanlar gözle seçildi.
  - eat, sun, bus ve hospital daha iyi aramalarla yeniden indirildi.

## v2 (BRIEF-v2) — canlıda (16 Ekim 2026)

- Geçiş 0003 canlı veritabanına uygulandı. Eski 3 ders 1–3 numarasını ve aktif sürelerini aldı; sıradaki ders 4.
- 21 somut kelimenin her birine 5 Pixabay adayı indi. Varsayılan fotoğraflar gözle seçildi.
- 1135 sesin hepsi hazır (Kokoro + korunan ElevenLabs klipleri). `validate-content` hatasız.
- Testler: 97 birim, 3 uçtan uca. Canlıda kontrol edildi: giriş sayfası, `/admin/review` (105 aday), medya dosyaları, `/api/cron/notify` 200.
- Pixabay fotoğrafları yardımcı bir oturumda indirildi; anahtar bu oturuma görünmüyordu (`claude/pixabay-images` dalı birleştirildi).

- 16 Ekim akşamı:
  - Telefondaki ders kaydı senkronu düzeltildi: kesirli milisaniye `bigint` alanına giremiyordu, sunucu artık yuvarlıyor (0005).
  - Senkron hataları `client_log` tablosuna düşüyor (0004).
  - Geçişler artık `schema_migrations` tablosunda izleniyor.
  - Derse "Önceki soru" oku eklendi.

## Ayrıntılar

- **İlerleme bitirilen derslere bağlı.**
  - Kodu: `src/core/progress.ts`, `src/core/session.ts`, `src/ui/screens/Lesson.tsx`.
  - Sunucuda `lesson_log` tablosu `number`, `active_ms` ve `day_ms` alanlarını tutuyor (migration 0003). `media_choices` tablosu `/admin/review` seçimlerini saklıyor.
  - Eski dersler sıra numarası alır. Eski kurulumdan kalan "15 dk" ayarı 20 dk hedef olur, `newPerDay` ise ders başına 10 kelime olur. Bu dönüşüm hem SQL'de hem istemcide aynı kuralla yapılır.
- **İçerik.**
  - Kaynaklar `content/ngsl/` (NGSL 1.2) ve `content/tatoeba/` (EN–TR alt kümesi, reddedilenler `rejected.json`).
  - Ünite dosyaları `content/units/unit-NN.*.json` (words, sentences, texts). Ünite 1 dışındaki kelime anlamları `content/units/glosses.json` havuzunda; derlenmiş hali `content/build/course.json`.
  - Dilbilgisi kartları `content/grammar.json`; örnekler yalnız kartın tetik kelimesine kadar bilinen kelimeleri kullanabilir (`validate-content` denetler).
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
  - Vercel ücretsiz planı günde en çok 5000 dosya yüklemeye izin verir; betik bu yüzden `--archive=tgz` ile tek arşiv yükler.
  - Yalnız uygulama için: `--app-only`.

## Bekleyen

- `PIXABAY_API_KEY` ortamda tanımlı (yeni oturumlarda görünür). Pexels yeni anahtar vermediği için `PEXELS_API_KEY` yok; bu bilinçli bir durum.
- Fotoğrafları yenilemek için:
  1. `npm run fetch-images -- --force --prune`
  2. Commit, ardından `npm run deploy -- --app-only`
  3. Kullanıcıya `/admin/review` adresini gönder.
- Ünite 6 ve sonrası:
  1. Kelimeler: `EVERYDAY[6]` ekle (gerekirse), `glosses.json` havuzunu tamamla, `unit-06.words.json` dosyasını havuzdan sırayla üret.
  2. `npm run import-tatoeba` (`MAX_POSITION` değerini büyüt), `MAX_WORDS_BY_UNIT` dizisine 6. ünite sınırını ekle.
  3. `unit-06.texts.json` yaz, gerekiyorsa `grammar.json` konuları ekle.
  4. `build-content`, `validate-content`, `fetch-images -- --words …`, `generate-audio`.
