# Panel — Dilim B: LLM Annotation (Metin → Script Otomatik)

> Tarih: 2026-07-16 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: `2026-07-16-panel-slice-a-design.md` (temel; §3 faz modeli, §4 veri modeli), `src/core/schema.ts` (script sözleşmesi)

## 1. Amaç

Dilim A'da script elle yapıştırılıyordu. Dilim B ile panel, **ham bölüm metni + anlatım tarzı + ses modunu** alıp **bağlı LLM ile** (ilk sağlayıcı: **Gemini**, BYO-key) doğrulanmış bir seslendirme script'i üretir; kaç parçaya bölündüğünü canlı gösterir; **ek talimatla yeniden üretme** sağlar. Elle JSON yapıştırma fallback olarak kalır.

**Karar (2026-07-16):** İlk LLM sağlayıcısı Gemini (mevcut `GEMINI_API_KEY`, text modellerinde cömert ücretsiz kota, TTS RPD kotasından ayrı). Adapter provider-agnostic; Claude/OpenAI ileride eklenir.

## 2. Ses modu ve ses havuzu

### 2.1 Ses modu (bölüm başına)
- `chapters.voice_mode TEXT NOT NULL DEFAULT 'narrator'` — `narrator` | `multi`.
- **narrator:** tüm segmentler `speaker='narrator'`; LLM yine segmentler + duygu/stil etiketler (tek sesli ama ifadeli).
- **multi:** LLM karakterleri tespit eder, konuşmaları etiketler. Ayar: **maks. karakter sayısı** `chapters.max_characters INTEGER NOT NULL DEFAULT 6` — fazlası anlatıcıya düşer (LLM'e prompt'ta bildirilir).

### 2.2 Ses havuzu ve atama
- `lib/voices-pool.ts`: doğrulanmış Gemini prebuilt sesleri etiketli sabit liste: `{ voiceId: 'gemini:Charon', gender: 'male', tone: 'olgun anlatıcı' }` benzeri (Charon, Algieba, Algenib, Leda, Schedar, Puck, Kore, Iapetus).
- LLM her karakter için tip döndürür: `gender: 'male'|'female'|'unknown'`, `age_hint: 'child'|'young'|'adult'|'elder'`, kısa `persona` (base_style'a girer).
- **Atama sistemde** (LLM sese karar vermez): anlatıcı → varsayılan anlatıcı sesi (settings `default_voice`, yoksa `gemini:Charon`); karakterler → havuzdan cinsiyet/tip uyumlu ilk boş ses (round-robin, deterministik).
- Panelde üretilen **cast listesi** görünür; ses düzeltme yolu: karakterin sesini açılır listeden değiştir → bu bir **script düzenlemesi**dir (yeni versiyon, LLM çağrısı YOK — sadece cast voice_id günceller); ya da ek talimatla tamamen yeniden üret.
- Prototip notu: TTS üretiminde `--single-voice`/`single_voice` ayarı hâlâ her şeyi ezebilir (Dilim A davranışı korunur).

## 3. LLM adapter (provider-agnostic)

```ts
// lib/llm/types.ts
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface LlmAnnotateRequest {
  system: string;           // sistem prompt (tarz + mod + kurallar + şema talimatı)
  user: string;             // chunk metni (+ önceki cast bağlamı)
  jsonSchema?: object;      // structured output şeması (destekleyen sağlayıcıda)
}
export interface LlmAdapter {
  readonly id: string;
  annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }>;
}
```

- **GeminiLlmAdapter** (`lib/llm/gemini.ts`): `@google/genai` (mevcut bağımlılık); model varsayılan `gemini-3-flash` (settings `llm_model` / env `LLM_MODEL` ile değişir); `responseMimeType: 'application/json'` + `responseSchema` (Yaklaşım A). Yanıt JSON parse edilemezse metinden ilk `{...}` bloğu ayıklanır (fallback).
- **MockLlmAdapter** (`lib/llm/mock.ts`): testler için — verilen metinden deterministik sahte script üretir (cümle başına segment, diyalog tırnak sezgisi), ağ yok.
- TTS adapter'daki dayanıklılık desenleri uygulanır: hata sınıflandırma + anlaşılır Türkçe mesajlar.

## 4. Annotation servisi

`lib/services/annotation.ts` — akış:

1. **Chunk'lama:** paragraf sınırından ~12.000 karakter hedefli parçalar (`chunkText(raw): string[]`); çoğu bölüm 1 chunk. Boş/çok kısa metin → Türkçe hata.
2. **Prompt kurulumu:** sistem prompt = anlatım tarzı (`narration_style`) + ses modu kuralları (narrator/multi + maks. karakter) + segmentasyon kuralları (cümle-öbek uzunluğu, duygu/stil etiketleri, `pause_after_ms` önerileri, Türkçe telaffuz sözlüğü `pronunciations`) + **çıktı şeması** (mevcut snake_case script JSON'u; `voice_id` alanı LLM'den İSTENMEZ — placeholder döner, sistem atar).
3. **Chunk döngüsü:** her chunk için `annotate()`; ilk chunk'ın cast'i sonraki chunk'ların prompt'una eklenir (karakter tutarlılığı). `onProgress(chunkDone, totalChunks)`.
4. **Doğrulama + retry:** LLM çıktısı chunk-şemasıyla (cast tipli, voice_id'siz) zod-doğrulanır; hatalıysa **1 retry** (zod hata özeti prompt'a eklenir). İkinci hata → o chunk için Türkçe hata fırlatılır (kısmi sonuç yazılmaz).
5. **Birleştirme:** cast'ler `character_id` üzerinden birleşir (tip çakışmasında ilk kazanır); segment id'leri `s1..sN` yeniden numaralanır; ses ataması (§2.2) uygulanır → tam `VoiceoverScript` JSON'u kurulur → **mevcut `parseScript` ile son doğrulama.**
6. **Kayıt:** `scripts` satırı `source='llm'`, `json`, `usage_json` (yeni kolon: `{inputTokens, outputTokens, chunks}`), versiyon artar; `segments` satırları (Dilim A `importScript` altyapısı yeniden kullanılır/ortaklaştırılır); chapter `scripted`.
7. **Yeniden üret:** `instruction?: string` — varsa sistem prompt'a "önceki denemeye dair kullanıcı düzeltmesi" bloğu + önceki versiyonun kısa özeti (cast + segment sayısı + ilk N segment örneği) eklenir; yeni versiyon yazılır.

### Şema değişiklikleri (migrasyon)
- `chapters.voice_mode` (TEXT, default 'narrator'), `chapters.max_characters` (INT, default 6)
- `scripts.usage_json` (TEXT NULL)

## 5. API + UI

### API
- `POST /api/chapters/[id]/annotate` — gövde `{ instruction?: string }`; **SSE:** `progress {chunk, totalChunks}` · `done {scriptId, version, segmentCount, castCount, usage}` · `error {message}`. Adapter: settings `llm_provider` → env `LLM_PROVIDER` → `'gemini'` (test: `'mock'`).
- `PATCH /api/chapters/[id]` genişler: `voiceMode`, `maxCharacters` alanları.
- `POST /api/chapters/[id]/cast-voice` — gövde `{ characterId, voiceId }`: en güncel script'in cast'inde sesi değiştirip **yeni versiyon** yazar (LLM yok).

### UI (`/chapters/[id]` çalışma alanı)
- **Ham metin kartı:** ses modu seçici (narrator/multi) + multi'de maks. karakter sayısı + "**Script üret (LLM)**" düğmesi + chunk ilerlemesi ("2/3 parça") + hata gösterimi.
- **Script kartı:** mevcut versiyon bilgisine ek **cast listesi** (karakter · tip · ses açılır listesi — havuzdan) + **ek talimat kutusu** + "Yeniden üret" düğmesi + usage/token bilgisi (küçük, muted). Elle JSON yapıştırma alanı kalır.

## 6. Faz modeli uyumu (Dilim A spec §3)

Üst seviye aşama `② LLM annotation` artık gerçek: bölüm `draft → (annotate: chunk ilerlemesi) → scripted → ④ TTS → done`. Chunk ilerlemesi SSE ile, TTS segment ilerlemesiyle aynı desen.

## 7. Test stratejisi

- **MockLlmAdapter ile:** chunkText (sınır/paragraf/boş metin), prompt kurulumu (mod/tarz/talimat blokları — string içerik asserted), zod-retry akışı (ilk çıktı bozuk → retry → geçerli), cast birleştirme + ses atama (narrator/multi, cinsiyet eşleşme, havuz round-robin, maks. karakter), annotation uçtan uca (`scripts.source='llm'`, versiyon, usage_json, chapter scripted), cast-voice değişikliği (yeni versiyon, LLM'siz).
- **API:** annotate SSE olay sırası (progress→done, hata yolu), PATCH yeni alanlar, cast-voice rotası.
- **GeminiLlmAdapter:** istek kurulum birim testi (model/schema parametreleri) — gerçek ağ çağrısı yok.
- Mevcut 62 test yeşil kalır.

## 8. Kapsam dışı (sonraki dilimler)

- Parça-bazı (chunk) yeniden üretim, segment düzenleme UI (elle metin/stil düzeltme) — ihtiyaç görülürse C/D.
- Claude/OpenAI LLM adapter'ları (arayüz hazır).
- Proje seviyesi kalıcı cast/ses kayıt defteri (şimdilik script-içi cast yeterli).
- Maliyet paneli/bütçe (Dilim C ile birlikte).

## 9. Riskler / notlar

- **LLM kota:** Gemini text free-tier RPM/RPD limitleri TTS'ten ayrıdır ama vardır; chunk başına 1-2 istek düşük hacim. 429'da anlaşılır Türkçe hata + tekrar dene önerisi.
- **Şema uyumu:** LLM'den voice_id istememek (sistem atar) geçerli-çıktı oranını yükseltir; son savunma hattı mevcut `parseScript`.
- **Uzun bölüm çıktı limiti:** chunk hedefi 12k karakter, Gemini flash çıktı limitine güvenli mesafede; gerekirse hedef küçültülür (sabit `lib/services/annotation.ts` içinde).
- **Karakter tutarlılığı:** chunk'lar arası cast aktarımı prompt'la; nadir çelişkiler cast birleştirmede "ilk kazanır" kuralıyla çözülür.
