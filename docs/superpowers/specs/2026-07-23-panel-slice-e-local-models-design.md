# Dilim E — Lokal Model Desteği (LM Studio + XTTS-v2)

**Tarih:** 2026-07-23 · **Durum:** Onaylandı (tasarım)

## Amaç

Kullanıcı paneli sıfır dış API bağımlılığıyla çalıştırabilsin: LLM annotation lokal
(LM Studio/Ollama vb.), TTS lokal (XTTS-v2 veya mevcut Piper). Kalite isteyen
kullanıcı API sağlayıcısına (bugün Gemini; ileride ElevenLabs vb.) geçebilsin.
"OpenAI-uyumlu" yalnızca endpoint formatı standardıdır; OpenAI hesabı/bağımlılığı
gerektirmez.

## Karar geçmişi (kullanıcıyla)

- Donanım hedefi: Apple Silicon M4 / 24 GB (gpt-oss-20b + XTTS aynı makinede; akış
  zaten sıralı olduğundan bellek zirveleri çakışmaz).
- Kapsam: genelleştirilmiş OpenAI-uyumlu LLM adapter'ı + XTTS-v2 bağlantısı + docs.
- XTTS bağlama yolu: **B — repo içinde ince Python sunucu** (topluluk sunucusu
  macOS'ta kırılgan; doğrudan alt süreç model-yükleme maliyeti nedeniyle elendi).
- Kapsam dışı (backlog): panelden ses klonlama yönetimi UI'ı, ElevenLabs adapter'ı.

## 1. LLM: OpenAI-uyumlu adapter — `lib/llm/openai.ts`

`LlmAdapter` arayüzünü uygulayan `OpenAiCompatLlmAdapter`:

- `POST {baseUrl}/chat/completions` — messages: `[system, user]`,
  `response_format: { type: 'json_object' }` (sunucu reddederse alansız yeniden dene).
- Yanıt temizliği: ` ```json ` kod çitleri ve `<think>…</think>` blokları content'ten
  sıyrılır, sonra `JSON.parse`. Şema doğrulama + 1 retry mevcut `annotateChunk`
  mekanizmasında kalır (adapter şema bilmez).
- Usage: yanıttaki `usage.prompt_tokens/completion_tokens`; yoksa 0.
- Maliyet 0 kabul edilir; Gemini kota defteri bu sağlayıcıda devreye girmez.

**Ayarlar** (`settings` tablosu + `.env` karşılıkları):

| Ayar | Env | Örnek |
|---|---|---|
| `llm_provider` = `openai-compat` | `LLM_PROVIDER` | `openai-compat` |
| `llm_base_url` | `LLM_BASE_URL` | `http://localhost:1234/v1` |
| `llm_api_key` (isteğe bağlı) | `LLM_API_KEY` | boş (LM Studio) / dolu (OpenRouter) |
| `llm_model` | `LLM_MODEL` | `openai/gpt-oss-20b` |

**UI:** Ayarlar sayfasında LLM sağlayıcı seçimi (`gemini` / `openai-compat` /
`mock`) + `openai-compat` seçilince adres/anahtar/model alanları. Tüm metinler
i18n (TR/EN). Bu iş `feat/panel-i18n` merge olduktan sonra yeni dalda yapılır.

## 2. TTS: İnce XTTS sunucusu — `tools/xtts-server/`

~100 satır Python/FastAPI; bakımı süren coqui-tts fork'u (idiap) kullanılır.

- **Endpoint:** `POST /v1/audio/speech` — gövde `{ model, voice, input,
  response_format: 'wav', language? }` → WAV bayt. Panelin mevcut
  `OpenAiCompatAdapter`'ı (src/core/tts/openai.ts) **sıfır panel koduyla** bağlanır:
  Ayarlar → Bağlantı ekle → `http://localhost:8020/v1`.
- **Sesler:** `tools/xtts-server/voices/*.wav`; dosya adı = ses adı = XTTS referans
  (klon) örneği. Kullanıcı kendi kaydını koyarak yeni ses ekler.
- **Dil:** açılışta `--lang tr` varsayılanı; istek `language` gönderirse o kazanır.
- **Donanım:** cihaz seçimi cuda → mps → cpu otomatik.
- **Dosyalar:** `server.py`, `requirements.txt`, `README.md` (kurulum: pip install +
  `uvicorn server:app --port 8020`).
- Model ağırlığı ilk çalıştırmada HF'den iner; süreç boyunca bellekte tutulur.

## 3. Dokümantasyon

`README.md` (EN) + `README.tr.md` (birebir, parite kuralı): "Tam lokal kurulum"
bölümü — LM Studio adımları, XTTS sunucusu, panel ayar değerleri, zayıf donanım
için Piper alternatifi, XTTS lisans notu (ağırlıklar CPML — ticari olmayan kullanım;
repo MIT kalır, modeli kullanıcı indirir).

## 4. Test

- `lib/llm/openai.ts` birim testleri (mock fetch): düz JSON, çitli JSON, `<think>`
  sızıntısı, `response_format` reddi sonrası alansız retry, HTTP hata mesajı.
- XTTS sunucusu için otomatik test yok (Python, ayrı süreç); M4 24GB üzerinde uçtan
  uca elle doğrulama: LM Studio → annotate → XTTS → dinleme + hız ölçümü.

## Riskler

1. gpt-oss-20b'nin Türkçe annotation şemasına uyumu ampirik; gerekirse prompt lokal
   modele göre ayarlanır (retry mekanizması ilk savunma hattı).
2. XTTS Mac (MPS/CPU) hızı bilinmiyor; ilk bölümde ölçülür, yavaşsa kullanıcıya
   Piper önerilir.
3. coqui-tts fork'unun macOS/Python sürüm uyumluluğu kurulumda sürpriz çıkarabilir;
   requirements sabitlenir (pin).
