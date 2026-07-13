# Bake-off Notları — Faz 1 TTS Motoru Kararı

**Tarih:** 2026-07-13
**Fixture:** `fixtures/sample-tr.json` (anlatıcı + 2 karakter, korku/öfke/alay tonları, "Aztharion" telaffuz testi)

## Denemeler

### Gemini 2.5 Flash Preview TTS (`gemini-2.5-flash-preview-tts`)
- 24.1 sn ses, raporlanan maliyet $0.0061.
- **Değerlendirme (kullanıcı):** Anlatıcı (Charon) fena değil ama **hız ve sesin kendisi robotik** hissettiriyor. Puck'ın (Kaan) **duygu tonlamaları sahte**.
- **Sonuç:** Reddedildi.

### Gemini 3.1 Flash TTS Preview (`gemini-3.1-flash-tts-preview`)
- 31.2 sn ses (2.5'ten belirgin daha yavaş/doğal tempo).
- **Değerlendirme (kullanıcı):** İyi — bununla devam.
- **Sonuç:** ✅ **Faz 1 motoru olarak kabul edildi.**

## Karar
- **Faz 1 TTS motoru: `gemini-3.1-flash-tts-preview`** (GeminiAdapter varsayılanı bu yapıldı).
- Adapter **swappable** kalır; Azure MAI-Voice-2 / Chirp 3 HD yedek olarak durur.
- **Maliyet:** 3.1, 2.5'in ~2 katı ($1/1M metin + $20/1M ses). Cost modülü model-farkında hale getirildi (`computeGeminiCost(..., model)`). Faz 1 (akış) düşük hacimde önemsiz; Faz 2 dev arşivde bu 2x fark hesaba katılmalı — gerekirse o noktada 2.5 batch / Chirp yeniden değerlendirilir.

## Gerçek-bölüm testi bulguları (2026-07-13)
- **RPM rate limit:** 3.1 preview tier'ında hızlı ardışık çağrılar dakikalık limite takılıyor (boş yanıt / 429). → adapter'a throttle (6s) eklendi. Hacim için darboğaz; tier/kota netleştirilmeli veya Cloud TTS/Vertex.
- **Kırılgan stil prompt'ları:** bazı stil talimatları (ör. "Style: nötr.") modeli sessizce boş yanıta itiyor. → adapter'a stilli→düz metin fallback eklendi.
- **Prototip kararı:** kullanıcı şimdilik **tek anlatıcı ses** istiyor (çoklu ses ertelendi). CLI `--single-voice gemini:Charon` ile.

## Açık / ileride
- Çoklu ses ileride geri açılabilir (mimari destekliyor); ses seçimi içerik kararı.
- Pace/telaffuz ince ayarı ileride style promptu ile güçlendirilebilir.
