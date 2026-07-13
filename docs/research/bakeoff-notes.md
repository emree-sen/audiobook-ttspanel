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

## Açık / ileride
- Puck (Kaan) sesi ve bazı karakterler için alternatif ses denemeleri yapılabilir (ses seçimi içerik kararı).
- Pace/telaffuz ince ayarı ileride style promptu ile güçlendirilebilir.
