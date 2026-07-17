# webnovel-tts

Web novel'leri (ve kendi metinlerini) duygu-duyarlı, çok-sesli seslendiren **self-host** sesli-kitap üretim & dinleme paneli. Kendi API anahtarını getirirsin (BYO-key), maliyeti kendin ödersin, verin kendi diskinde kalır.

## Durum

- ✅ Ses çekirdeği: JSON seslendirme script'i → Gemini TTS → mp3 (CLI)
- ✅ Web panel (Dilim A): proje/bölüm yönetimi, script import, üretim + dinleme
- ✅ LLM annotation: ham metin + anlatım tarzı + ses modu → otomatik script (Gemini, BYO-key); ek talimatla yeniden üretme; cast ses düzeltme
- ✅ Üretim hattı: DB-destekli kuyruk (tarayıcı kapansa da sürer), preflight çağrı hesabı + günlük kota göstergesi, kotaya çarpınca duraklat/devam, content-hash önbelleği (değişmeyen segment tekrar TTS'e gitmez), segment başına dinleme + tek-segment yeniden üretme
- ⬜ Sağlayıcı ekosistemi (OpenAI-uyumlu endpoint + Piper lokal TTS + ayarlar ekranı), PWA oynatıcı

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

## Kullanım

1. Panelde proje → bölüm oluştur, ham metnini yapıştır; anlatım tarzını ve ses modunu (tek anlatıcı / çok karakterli) seç.
2. **"Script üret (LLM)"** → sistem metni segmentlere ayırır, duygu/stil etiketler, karakterlere havuzdan ses atar. Beğenmezsen ek talimat yazıp **"Yeniden üret"**; karakter sesini listeden değiştir.
3. "Üret" → segment segment TTS + birleştirme → tarayıcıda dinle.

Ücretsiz deneme: `.env`'de `TTS_PROVIDER=mock` ve `LLM_PROVIDER=mock` (API çağrısı yapmaz). Elle JSON script yapıştırma "gelişmiş" bölümünde durur (şema: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md` §6).

## Bilinen kısıtlar

- Gemini TTS free tier: **günde 100 istek** (model başına). Panel bunu yönetir: üretim öncesi kaç çağrı gerektiğini gösterir, hak bitince işi duraklatır, ertesi gün "Devam et" ile sürersiniz. Faturalı anahtarda `quota_limit_gemini` ayarını yükseltin.
- LLM annotation varsayılanı `gemini-2.5-flash` (ücretsiz kota, TTS kotasından ayrı); `LLM_MODEL` ile değiştirilebilir.
- Ses `<audio>` ile tam-dosya servis edilir; ileri sarma kısıtlı olabilir (iyileştirme planlı).

## Veri

Her şey `./data/` altında: `app.db` (SQLite) + `audio/` (mp3'ler). Yedeklemek = bu klasörü kopyalamak.
