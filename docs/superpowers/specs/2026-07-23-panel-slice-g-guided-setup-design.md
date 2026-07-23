# Dilim G — Rehberli Kurulum (akıllı preset + hızlı kurulum kartı + wav yükleme)

**Tarih:** 2026-07-23 · **Durum:** Onaylandı (tasarım)

## Amaç

Dilim F sonrası kalan beş yeni-kullanıcı tuzağını kapatmak: (1) iki-motor kavramının
anlatılmaması, (2) aktif sağlayıcının elle değiştirilmesi, (3) ses havuzu / wav adı
eşleşmesinin gizli bilgi olması, (4) referans wav'ın dosya sistemine elle konması,
(5) LLM model adının körlemesine yazılması. Kullanıcı seçimi: A+B+C (sihirbaz D
elendi — YAGNI).

## A) Akıllı preset'ler

- **Probe zenginleştirme:** `POST /api/probe` yanıtına isteğe bağlı listeler eklenir:
  `models: string[]` (llm; `/models` yanıtındaki id'ler, ilk 20) ve
  `voices: string[]` (tts; `/health.voices`). `ok/detail` sözleşmesi değişmez.
- **LLM model seçici:** Ayarlar'da "Bağlantıyı sına" sonucu model listesi geldiyse
  bir `<select>` belirir; seçim `put({ llmModel })` ile kaydeder ve alanı doldurur.
- **XTTS preset'i "gerçekten tek tık":** tıklandığında sırasıyla — bağlantı yoksa
  oluşturur → **aktif sağlayıcıyı `xtts` yapar** → `/health`'ten sesleri çekip havuzda
  olmayanları `POST /api/voices` ile ekler. Bağlantı zaten varsa düğme "Sesleri
  eşitle"ye dönüşür (yalnız eşitleme yapar). Eşitleme istemci tarafında döngüyle
  yapılır (yeni uç yok).

## B) "Hızlı kurulum" kartı

Ayarlar'ın en üstüne (dil kartından sonra) 3 adımlı durum kartı; her satır ✓ / —
işareti + tek cümle ipucu + ilgili karta kaydıran bağlantı (`scrollIntoView`, kart
`id`'leri eklenir):

1. **Beyin (LLM):** yapılandırılmış mı? — `gemini` + anahtar var YA DA
   `openai-compat` + adres + model. İpucu: "Metni kim konuşuyor/hangi duyguyla
   analiz eden model."
2. **Ses (TTS):** aktif sağlayıcı kullanılabilir mi? — `gemini`+anahtar /
   `piper`+exe+model / bağlantı satırı mevcut / `mock`. İpucu: "Script'i sese
   çeviren motor."
3. **Ses havuzu:** aktif sağlayıcının havuzunda ≥1 ses var mı?

Durum bilgisi mevcut GET /api/settings yanıtından türetilir (yeni uç yok; gerekirse
yanıta `piperModelCount` gibi küçük alan eklenir — tercihen mevcut `voices`
haritasından türet).

## C) Panelden referans wav yükleme

- **API:** `GET /api/xtts/voices` — `tools/xtts-server/voices/*.wav` listesi (sunucu
  çalışmasa da dosya sisteminden). `POST /api/xtts/voices` — multipart form
  (`file`); ad temizlenir (`[a-z0-9-_]`, path traversal koruması), yalnız `.wav`
  uzantısı, boyut sınırı 20MB; kayıttan sonra `xtts` bağlantısı varsa havuza
  otomatik eklenir. `DELETE /api/xtts/voices/[name]` — dosyayı siler (havuz kaydına
  dokunmaz; kullanıcı havuzdan ayrıca siler).
- **UI:** XTTS sunucusu kartına "Referans sesler" bölümü: dosya listesi + yükleme
  input'u + silme. İpucu: 6-30 sn temiz kayıt; dosya adı = ses adı.
- Yükleme çalışan sunucuya yansır (XTTS her istekte dosyadan okur; yeniden
  başlatma gerekmez — /health listesi anlık günceller).

## Test

- Probe genişletmesi: mevcut testler + models/voices alan testleri.
- `/api/xtts/voices`: ad temizleme, uzantı/boyut reddi, path traversal, listeleme,
  silme (geçici dizinle; route dizini parametrik/env ile test edilebilir yapılır).
- Hızlı kurulum durum türetimi: saf fonksiyon olarak (`lib/ui` veya sayfa içi
  helper `setupStatus(data)`) birim testlenir.
- i18n parite; UI elle doğrulama kullanıcıda.

## Kapsam dışı

Kurulum sihirbazı sayfası (D), ses önizleme/oynatma, wav format dönüştürme
(yalnız .wav kabul), uzak makinedeki XTTS'e dosya yükleme (sidecar yereldir).
