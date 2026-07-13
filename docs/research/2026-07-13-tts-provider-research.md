# TTS Sağlayıcı Araştırması — Türkçe Sesli Kitap (Web Novel)

**Tarih:** 2026-07-13
**Yöntem:** deep-research harness — 5 açı, 20 kaynak, 93 iddia çıkarıldı, 25 iddia 3-oylu çapraz-doğrulamadan geçti (23 doğrulandı, 2 çürütüldü).
**Soru:** Türkçe öncelikli, çok sesli + segment-bazlı duygu kontrolü olan, ucuz ama iyi, API-tabanlı (Google öncelikli) uzun-form TTS.

---

## TL;DR — Tavsiye

- **Faz 1 (akış) başlangıcı:** **Gemini 2.5 Flash Preview TTS** (Gemini API / AI Studio). Türkçe GA-destekli, **ücretsiz katmanda $0**, ve Google seçenekleri içinde **en güçlü segment-bazlı duygu/stil kontrolü** (doğal dil promptu + `[whispering]`, `[sarcasm]`, `[sigh]`, `[shouting]` gibi köşeli-parantez etiketleri).
- **Yapısal kısıt:** 32k token bağlam penceresi + "birkaç dakikadan uzun çıktıda kalite kayması" uyarısı + **istek başına sabit 2 konuşmacı sınırı** → her bölüm **parçalara bölünüp, segment başına tek ses/tek çağrı** üretilip **birleştirilmeli**. Bu, bizim JSON "seslendirme scripti" + adapter mimarimize birebir oturuyor.
- **Faz 2 (dev arşiv) maliyeti:** Gemini **karakter değil SÜRE** üzerinden ücretlendiriliyor (25 token/sn). 2.5 Flash ≈ **$0.90/ses-saati** (standart), **~$0.45/ses-saati** (batch) — ölçekte Chirp 3 HD'nin karakter fiyatını genelde alt ediyor.
- **⚠️ EN KRİTİK UYARI:** Tek belirleyici kriter olan **Türkçe doğallık/prozodi HİÇBİR kaynakta kanıtlanmadı.** GA = "destekleniyor", "iyi ses veriyor" DEĞİL. **Karar dokümana göre verilemez → ampirik kör A/B testi (bake-off) şart.**

---

## 1. Türkçe Kalitesi (make-or-break)

- **Google:** Türkçe (tr-TR) hem Gemini-TTS hem Chirp 3 HD'de **GA (Generally Available)**. Gemini 2.5 TTS Flash & Pro 30 Eylül 2025'te GA oldu ("30 konuşmacı, 80+ locale"). Chirp 3 HD'ye Türkçe 6 Mart 2025'te eklendi.
- **KRİTİK BOŞLUK:** Tüm kaynaklar yalnızca **destek/erişilebilirlik** kanıtlıyor; **Türkçe prozodi/doğallık için hiçbir benchmark yok.** Bu her sağlayıcı (Google/Azure/ElevenLabs) için geçerli.
- **Aksiyon:** Aynı Türkçe pasajı (anlatım + duygulu diyalog + uydurma fantastik isim) Gemini 2.5 Flash TTS, Chirp 3 HD, Azure MAI-Voice-2 ve ElevenLabs'te üretip **kör karşılaştır.**

## 2. Duygu / Stil Kontrolü

- **Gemini-TTS:** Doğal dil promptu + köşeli-parantez etiketleri (SSML DEĞİL): `[sigh]`, `[laughing]`, `[whispering]`, `[sarcasm]`, `[shouting]`, `[scared]`, `[curious]`, `[bored]`, `[extremely fast]` vb. **Uyarılar:** (a) etiketler Preview + **non-deterministik** (her seferinde farklı çıkabilir); (b) dokümanlar İngilizce olmayan metinlerde bile **etiketleri İngilizce yazmayı** öneriyor → Türkçe için etkinliği **kanıtlanmamış**, test gerekli.
- **Azure (en güçlü DOĞRULANMIŞ Türkçe duygu):** İki Türkçe MAI-Voice-2 sesi (`tr-TR-Aydın` erkek, `tr-TR-Elif` kadın), her biri **10 stil**: adventurous, caringempathy, curious, encouraging, excited, friendlycheerful, nostalgic, reflective, saddisappointed, serious. **Eksik:** `angry`, `whispering`, `sarcastic` (bu üçü Türkçe'de yok).
- **ElevenLabs:** Multilingual v2 "duygusal-farkında" model, Türkçe destekli — ama duygu Türkçe için yalnızca **pazarlama iddiası**, benchmark yok.
- **Çürütülen iddia:** "Chirp 3 HD SSML/speaking-rate/pitch desteklemiyor" iddiası **çürütüldü (0-3)** → bazı prozodi parametreleri Chirp 3 HD'de çalışıyor olabilir (pozitif teyit toplanmadı).

## 3. Çok Ses (Multi-voice)

- **Gemini:** İstek başına **sabit 2 ses sınırı** (Gemini 3.1'de bile). 3+ karakter için → **her bitişik aynı-konuşmacı segmenti ayrı tek-ses çağrısı** + birleştirme. ~30 seçilebilir ses havuzu.
- **Chirp 3 HD:** 30 adlandırılmış ses (gök cismi isimleri: Achernar, Aoede, Kore, Puck, Charon, Zephyr...), Türkçe için ≥8 (4E/4K, sonra 30'a doğru genişleme). **Avantaj:** Her çağrı sabit ses kimliği adlar → binlerce segment çağrısında **ses tutarlılığı generatif modelden daha deterministik** (kitap boyu kadro için önemli). **Ayrıca Türkçe'de pace/pause/özel telaffuz kontrolü var** (fantastik isim telaffuzu için birebir). Ama Gemini'nin doğal-dil duygu kontrolü **yok**.

## 4. Fiyatlandırma (mid-2026)

### Gemini native TTS — SÜRE üzerinden (25 token/sn → 1M ses-tokeni ≈ 11.1 saat)
| Model | Metin girişi | Ses çıkışı | ~$/ses-saati (std) | ~$/ses-saati (batch) |
|---|---|---|---|---|
| **Gemini 2.5 Flash Preview TTS** | $0.50/1M | $10/1M | **~$0.90** | **~$0.45** |
| Gemini 2.5 Pro TTS | $1/1M | $20/1M | ~$1.80 | ~$0.90 |
| Gemini 3.1 Flash TTS | $1/1M | $20/1M | ~$1.80 | ~$0.90 |

> ⚠️ **Gotcha:** "3.1 Flash", ismine rağmen 2.5 Flash'ın **2 katı** ses maliyeti. Senin gördüğün "3.1 flash" değil, **2.5 Flash** daha ucuz ve ücretsiz.

### Google Cloud TTS — KARAKTER üzerinden
| Tier | $/1M karakter | Ücretsiz/ay | 20M | 50M | 70M |
|---|---|---|---|---|---|
| Standard / WaveNet | $4 | 4M | ~$64 | ~$184 | ~$264 |
| Neural2 | $16 | 1M | ~$304 | ~$784 | ~$1,104 |
| **Chirp 3 HD** | $30 | 1M | ~$570 | ~$1,470 | ~$2,070 |
| Studio | $160 | 1M | çok yüksek | — | — |

### Diğer
- **Azure:** Standard Neural ~$15-16/1M; Neural HD V2 ~$30/1M. 20M ≈ $300-480 (std neural).
- **ElevenLabs:** $30-100/1M (premium; en pahalı, kalite-öncelikli).

### Faz 2 projeksiyonu (3M-10M kelime ≈ 333-1,111 ses-saati @ ~150 wpm)
- **Gemini 2.5 Flash:** ~$300-$1,000 (std), **~$150-$500 (batch)** ← ölçekte en ucuz ifade-yetenekli seçenek.
- Sezgi: ~3000 kelimelik bölüm ≈ ~20k karakter ≈ ~13-14 dk ses. Chirp 3 HD'de ≈ **$0.60/bölüm**; Gemini 2.5 Flash batch ≈ **~$0.10/bölüm**; AI Studio ücretsiz katman = **$0**.

## 5. 💳 Ücretsiz Kredi Nüansı (ÖNEMLİ — doğrulanmalı)

- $0 Gemini 2.5 Flash TTS **ücretsiz katmanı**, **ai.google.dev (Gemini API / AI Studio)** yüzeyinde. Rate limit düşük (tek haneli RPM) ama haftada birkaç bölüm için yeterli.
- Senin **birkaç yüz dolarlık kredin büyük ihtimalle Google CLOUD kredisi** → Cloud TTS (Chirp 3 HD $30/1M) ve **Gemini-via-Vertex**'e uygulanır, **ai.google.dev ücretsiz/ücretli katmanına DEĞİL.** Bunlar **ayrı faturalama yüzeyleri.**
- Kredi menzili (Cloud'a uygulanırsa): ~$300 ≈ **10M Chirp 3 HD karakteri**, veya ~**333 ses-saati** Gemini 2.5 Flash (Vertex std) / ~667 saat batch.
- **Aksiyon:** Hesabında hangi kredinin olduğunu kontrol et (AI Studio API key mi, GCP faturalama kredisi mi).

## 6. Uzun-form Best Practices

- **Chunking zorunlu:** 32k token pencere + "birkaç dk sonra kayma" → bölümleri kısa segmentlere böl, üret, birleştir. JSON şeması segment başına `{speaker, voice, text, style_prompt/tags}` taşımalı.
- **Tutarlılık:** Her segment çağrısında **aynı sabit sesi + aynı stil promptunu** yeniden geç.
- **Fantastik isim telaffuzu:** Chirp 3 HD'de custom pronunciation Türkçe'de mevcut; Gemini'de prompt içi telaffuz ipucu.

## 7. Kapsanamayan / Doğrulanamayan (açık sorular)

- **ToS/Hukuk:** Telifli web novel'in kişisel-kullanım seslendirmesi + kendi içeriğin + ticari kullanım/ses sahipliği → **hiçbir doğrulanmış iddia yok.** Ayrıca araştırılmalı.
- **OpenAI TTS** Türkçe kalitesi doğrulanmadı.
- Rate limit detayları, max girdi, çıktı formatları (mp3/wav/opus/pcm), latency, long-audio/streaming async → doğrulanmadı.

---

## Sağlayıcı Stratejisi (mimari sonuç)

1. **Provider-agnostic adapter** (zaten planlandı) — şart, çünkü Türkçe kalite ampirik test gerektiriyor; sağlayıcıyı değiştirebilmeliyiz.
2. **Faz 1 varsayılan motoru:** Gemini 2.5 Flash TTS (ücretsiz + en iyi duygu kontrolü) — **bake-off'a bağlı.**
3. **Tutarlılık-öncelikli alternatif:** Chirp 3 HD (deterministik ses kimliği + telaffuz kontrolü).
4. **Doğrulanmış Türkçe-duygu yedeği:** Azure MAI-Voice-2 (Aydın/Elif).
5. **Kalite-öncelikli premium yedek:** ElevenLabs Multilingual v2.

## Kaynaklar (öne çıkanlar)
- Gemini API speech: https://ai.google.dev/gemini-api/docs/speech-generation
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Cloud TTS Gemini-TTS: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- Cloud TTS Chirp 3 HD: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- Cloud TTS pricing: https://cloud.google.com/text-to-speech/pricing
- Cloud TTS release notes: https://docs.cloud.google.com/text-to-speech/docs/release-notes
- Azure Speech language support: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
- ElevenLabs models: https://elevenlabs.io/docs/overview/models
