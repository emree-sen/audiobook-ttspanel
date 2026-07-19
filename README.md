# webnovel-tts

Web novel'leri (ve kendi metinlerini) duygu-duyarlı, çok-sesli seslendiren **self-host** sesli-kitap üretim & dinleme paneli. Kendi API anahtarını getirirsin (BYO-key), maliyeti kendin ödersin, verin kendi diskinde kalır.

## Durum

- ✅ Ses çekirdeği: JSON seslendirme script'i → Gemini TTS → mp3 (CLI)
- ✅ Web panel (Dilim A): proje/bölüm yönetimi, script import, üretim + dinleme
- ✅ LLM annotation: ham metin + anlatım tarzı + ses modu → otomatik script (Gemini, BYO-key); ek talimatla yeniden üretme; cast ses düzeltme
- ✅ Üretim hattı: DB-destekli kuyruk (tarayıcı kapansa da sürer), preflight çağrı hesabı + günlük kota göstergesi, kotaya çarpınca duraklat/devam, content-hash önbelleği (değişmeyen segment tekrar TTS'e gitmez), segment başına dinleme + tek-segment yeniden üretme
- ✅ Sağlayıcı ekosistemi (Dilim C2): OpenAI-uyumlu bağlantılar + Piper lokal TTS, Ayarlar ekranı, sağlayıcı-bazlı ses havuzu, stilsiz sağlayıcılarda otomatik stil düşürme notu
- ✅ Üretim akışı iyileştirmeleri (Dilim C3): anlatıcı modunda az-segment (paragraf kuralı + birleştirme), script/segment satır düzenleme, ayrı "Birleştir" adımı (segmentler hazır → `voiced` → mp3), TTS süre bekçisi (absürt uzunlukta otomatik yeniden deneme), dev'de çift-worker kota israfı düzeltmesi
- ✅ Kütüphane + PWA oynatıcı (Dilim D): /library sayfası (devam et + seri listesi + indir/sil), DB'de kaldığı yerden devam, global alt çubuk oynatıcı (MediaSession, 0.75-2x hız, ±15/30 sn, otomatik sonraki bölüm), PWA kurulumu + offline dinleme (service worker)

## Kurulum

Gereksinimler: Node ≥ 20.

```bash
git clone <repo>
cd webnovel-tts
npm install
cp .env.example .env   # GEMINI_API_KEY ve PANEL_PASSWORD doldur
npm run dev            # http://localhost:3000
```

> **Uyarı:** `PANEL_PASSWORD` boşsa panel şifresiz açılır — yalnızca lokal geliştirme için. İnternete açacaksan mutlaka doldur.

Üretim (production) için: `npm run build && npm start`.

## TTS Sağlayıcıları

Aktif sağlayıcı ve tüm yapılandırma panel içinden yönetilir: **Ayarlar** (sol panelin altı).

### Gemini (varsayılan)
API anahtarını `.env` (`GEMINI_API_KEY`) veya Ayarlar ekranından gir. Ücretsiz katmanda
günde ~100 istek sınırı vardır; panel preflight + kota defteriyle bunu yönetir.

### OpenAI-uyumlu sunucular (lokal veya bulut)
`/v1/audio/speech` uygulayan her sunucu: OpenAI TTS, [AllTalk](https://github.com/erew123/alltalk_tts),
[openedai-speech](https://github.com/matatonic/openedai-speech), LocalAI…
Ayarlar → "OpenAI-uyumlu bağlantılar" → ad + URL (`/v1` dahil, ör. `http://localhost:8000/v1`) +
model + (gerekiyorsa) anahtar. Bağlantının ses havuzunu elle doldur veya "Resmî OpenAI seslerini ekle".
Not: sunucu `response_format: "wav"` desteklemeli (yaygın durum).

### Piper (ücretsiz, lokal, CPU)
1. [Piper sürümünü](https://github.com/OHF-Voice/piper1-gpl/releases) indir, bir klasöre aç (`piper.exe`).
2. Türkçe ses modeli indir (`.onnx` + `.onnx.json` YAN YANA aynı klasörde):
   [tr_TR-fahrettin-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/fahrettin/medium),
   [tr_TR-dfki-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium),
   [tr_TR-fettah-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/fettah/medium).
3. Ayarlar → Piper: exe yolunu gir, model dosyalarını ekle (ses adı dosya adından türer).

Stil/duygu yönergelerini yalnız Gemini uygular; diğer sağlayıcılarda segmentler düz okunur
(panel preflight satırında not gösterir).

## Kullanım

1. Panelde proje → bölüm oluştur, ham metnini yapıştır; anlatım tarzını ve ses modunu (tek anlatıcı / çok karakterli) seç.
2. **"Script üret (LLM)"** → sistem metni segmentlere ayırır, duygu/stil etiketler, karakterlere havuzdan ses atar. Beğenmezsen ek talimat yazıp **"Yeniden üret"**; karakter sesini listeden değiştir.
3. "Üret" → segment segment TTS. Üretim bitince segmentleri dinleyip düzelt (gerekirse metni değiştirip yeniden üret), ardından **"Birleştir"** ile tek mp3'e dönüştür ve tarayıcıda dinle.

Ücretsiz deneme: `.env`'de `TTS_PROVIDER=mock` ve `LLM_PROVIDER=mock` (API çağrısı yapmaz). Elle JSON script yapıştırma "gelişmiş" bölümünde durur (şema: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md` §6).

## Dinleme (PWA)

Panel aynı zamanda telefonunuzda kurulabilen bir sesli-kitap oynatıcısıdır (Progressive Web App).

- **Telefonda kurulum:** Chrome'da paneli aç → menü → "Ana ekrana ekle". (PWA kurulumu **HTTPS veya localhost** gerektirir; SW yalnız `npm run build && npm start` ile çalışan production build'de kayıt olur, `npm run dev`'de PWA özellikleri kapalıdır.)
- **Kütüphane / devam et:** Sol menüden **Kütüphane**; en üstte "Devam et" kartı en son dinlediğiniz bölümü kaldığınız yerden açar, altında seriye göre gruplanmış bölüm listesi vardır.
- **İndir → çevrimdışı dinleme:** Bir bölümü indirin, ardından uçak modunda bile `/library` açılır, indirilen bölümler çalar ve ileri/geri sarma (seek) çalışır. Sil ile indirilen dosya cihazdan kaldırılır ve tahmini alan düşer.
- **Kontroller:** Alttaki genel oynatıcı çubuğunda çal/duraklat, ±15/30 saniye atlama, 0.75×-2× hız (kalıcı) ve kilit ekranı/bildirim kontrolleri (MediaSession: başlık, seri, çal-duraklat, ileri/geri, sonraki) bulunur. Bölüm bitince sırasıyla sonraki bölüme otomatik geçer.
- **iOS kısıtı:** iOS Safari'de arka planda çalma ve kilit ekranı kontrolleri sınırlı olabilir (Apple'ın PWA/MediaSession desteği kısıtlı); birincil hedef platform **Android**'dir.

## Bilinen kısıtlar

- Gemini TTS free tier: **günde 100 istek** (model başına). Panel bunu yönetir: üretim öncesi kaç çağrı gerektiğini gösterir, hak bitince işi duraklatır, ertesi gün "Devam et" ile sürersiniz. Faturalı anahtarda `quota_limit_gemini` ayarını yükseltin.
- LLM annotation varsayılanı `gemini-2.5-flash` (ücretsiz kota, TTS kotasından ayrı); `LLM_MODEL` ile değiştirilebilir.
- Ses `<audio>` ile tam-dosya servis edilir; ileri sarma kısıtlı olabilir (iyileştirme planlı).

## Veri

Her şey `./data/` altında: `app.db` (SQLite) + `audio/` (mp3'ler). Yedeklemek = bu klasörü kopyalamak.
