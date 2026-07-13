# Web Novel Çok-Sesli Sesli Kitap Sistemi — Tasarım Dokümanı (Spec)

**Tarih:** 2026-07-13
**Durum:** Onaylandı (brainstorming), implementasyon planı bekliyor
**İlgili araştırma:** [`docs/research/2026-07-13-tts-provider-research.md`](../../research/2026-07-13-tts-provider-research.md)

---

## 1. Özet

Uzun soluklu, çok bölümlü web novel'leri (ve zaman zaman kullanıcının kendi metinlerini) **çok sesli** ve **segment-bazlı duygu/ton** ile seslendiren; serileri/sezonları/bölümleri listeleyip dinlenebilen; **üretim hattını tüm detaylarıyla izleyip yönetebilen bir panele** sahip, kendi VPS'inde barınan bir sesli-kitap üretim ve dinleme sistemi.

**Temel fikir / iş bölümü:** Ham bölüm metni → **Claude (oturum içinde, elle) yapılandırılmış bir "seslendirme scripti" (JSON) üretir** → sistem bu scripti alıp segment-segment TTS'e gönderir, ses parçalarını birleştirir, depolar ve oynatıcıda sunar. Otomatik hatta LLM yoktur (çalışma maliyeti sadece TTS). "Annotator" adımı, ileride otomatik bir LLM adımıyla değiştirilebilecek **temiz bir JSON sözleşmesi** olarak tasarlanır.

## 2. Hedefler ve Kapsam Dışı

### Hedefler (Faz 1)
- Tek kullanıcı (sahibi), web'den her cihazdan erişim, PWA.
- Türkçe birincil kalite; İngilizce ikincil destek.
- Karakter başına ses ataması (çok sesli), segment-bazlı duygu/stil.
- Uçtan uca bir bölümü: metin → JSON script → TTS → birleştirme → telefonda dinleme.
- Üretim hattını segment düzeyinde izleyen + maliyet gösteren panel.

### Kapsam Dışı (Faz 1 — sonraya)
- Otomatik LLM annotator ve toplu (1000+ bölüm) arşiv dönüşümü → **Faz 2**.
- Native mobil uygulama (Expo) → şimdilik PWA yeterli.
- Offline indirme → Faz 1.5.
- Segment-bazlı metin takibi (follow-along) → ileride.
- Ses klonlama (voice cloning) → gerekmiyor (hazır ses havuzu kullanılıyor).
- Çok kullanıcılı / paylaşım / hesap sistemi → gerekmiyor.

## 3. Temel Kararlar

| Konu | Karar |
|---|---|
| Barındırma | **Supabase Cloud** (Postgres · Auth · Storage) + **Next.js app & worker kullanıcının VPS'inde** |
| Kullanıcı | Esas sahibi; web erişimli; PWA |
| İçerik | Web noveller + kendi metinleri |
| Dil | Türkçe birincil (belirleyici), İngilizce ikincil |
| Ses | Çok sesli — karakter başına ses ataması (ses registry'si) |
| Duygu | Segment düzeyinde duygu/ton |
| İş bölümü | Ham metin → Claude elle JSON "seslendirme scripti" üretir → sistem TTS + oynatma. Annotator sonradan otomatikleşebilir sözleşme. |
| Hacim | Faz 1: güncel akış (elle analiz). Faz 2: dev arşiv (otomatik annotator). |
| TTS (Faz 1) | **Gemini 2.5 Flash Preview TTS** (varsayılan); provider-agnostic adapter |
| TTS alternatifleri | Chirp 3 HD (tutarlılık), Azure MAI-Voice-2 (doğrulanmış Türkçe duygu), ElevenLabs (premium) — swappable |
| Analiz akışı | Panel üzerinden: raw_text yapıştır → sohbette Claude'a ver → JSON → panelde import |
| İstemci | Responsive web + PWA (panel + oynatıcı tek kod) |
| Krediler | Google free-trial + prepay key'ler; kredi hem Gemini API hem Cloud/Vertex kullanımına uygulanır (ilk testte doğrulanacak) |

## 4. Mimari & Bileşenler

```
┌─────────────────────────── Kullanıcının VPS'i ─────────────────────┐
│   Next.js (App Router, TS)  ──►  Panel + Oynatıcı (PWA, tek kod)    │
│         │ REST/RPC                          ┌── ffmpeg (birleştirme)│
│         ▼                                   │                       │
│   Worker (Node/TS, PM2/Docker) ──► TTS Adapter ──► Gemini 2.5 Flash │
│         │  (Postgres job kuyruğunu poll eder)  (swappable adapter)  │
└─────────┼──────────────────────────────────────────────────────────┘
          ▼
   Supabase Cloud:  Postgres (veri)  ·  Auth (giriş)  ·  Storage (ses)
```

- **Next.js app:** panel + oynatıcı + API rotaları. VPS'te Node olarak çalışır.
- **Worker:** ayrı uzun-çalışan süreç; Postgres `jobs` kuyruğunu poll eder; TTS Adapter'ı çağırır; ffmpeg ile birleştirir; Storage'a yazar; durumları günceller.
- **TTS Adapter:** sağlayıcı-bağımsız arayüz (bkz. §7). Faz 1 = Gemini; diğerleri sonradan takılır.
- **Supabase Cloud:** Postgres + Auth + Storage (yönetilen; otomatik backup).

## 5. Veri Modeli (Postgres)

| Tablo | Amaç | Önemli alanlar |
|---|---|---|
| `series` | Seri | id, title, language, description, cover_url, user_id, created_at |
| `seasons` | Sezon | id, series_id, number, title |
| `episodes` | Bölüm | id, season_id, number, title, **status**, raw_text, script_json (jsonb), duration_ms, cost_total, created_at |
| `characters` | Seri-düzeyi kadro (tekrar kullanılır) | id, series_id, slug, display_name, default_voice_id, base_style |
| `voices` | **Ses registry'si** | id, provider, provider_voice, friendly_name, gender, language, sample_url, notes |
| `segments` | **TTS birimi** (izleme/üretim) | id, episode_id, idx, speaker (character slug), type, text, style, tags (jsonb), pause_after_ms, voice_id, **status**, audio_url, duration_ms, cost, content_hash, error, attempt |
| `jobs` | Üretim işi | id, episode_id, type, status, progress, error, created_at, started_at, finished_at |

**Bölüm durumu:** `draft → script_ready → queued → generating → ready | failed`
**Segment durumu:** `pending → generating → done | failed`

**Storage düzeni (bucket: `audio`):**
```
audio/{series_id}/s{season}/e{episode}/seg_{idx}.mp3   # her segment
audio/{series_id}/s{season}/e{episode}/episode.mp3      # birleştirilmiş bölüm
```
Ayrıca `voice-samples/` bucket'ı (registry örnek sesleri).

**Auth:** Supabase Auth (email/magic link). RLS ile tüm satırlar `user_id`'ye kilitli.

## 6. Seslendirme Scripti — JSON Şeması (sözleşme 🫀)

Claude'un ürettiği, sistemin işlediği sağlayıcı-bağımsız sözleşme. Her adapter *elinden geleni* kullanır; desteklenmeyen alanı zarifçe düşürür.

```jsonc
{
  "schema_version": "1.0",
  "series": "Gölge Hükümdarı", "season": 1, "episode": 12,
  "title": "Uyanış", "language": "tr-TR",
  "cast": [
    { "character_id": "narrator", "display_name": "Anlatıcı",
      "voice_id": "gemini:Charon", "base_style": "sakin, ölçülü, 3. şahıs anlatım" },
    { "character_id": "kaan", "display_name": "Kaan",
      "voice_id": "gemini:Puck", "base_style": "genç, kararlı erkek" }
  ],
  "segments": [
    { "id": "s001", "speaker": "narrator", "type": "narration",
      "text": "Kapı gıcırdayarak açıldı.",
      "style": "gerilimli, yavaş", "pause_after_ms": 300 },
    { "id": "s002", "speaker": "kaan", "type": "dialogue",
      "text": "Kim var orada?",
      "style": "korkmuş ama meydan okuyan", "tags": ["[scared]"] }
  ],
  "pronunciations": [ { "term": "Aztharion", "say_as": "Az-ta-ri-on" } ]
}
```

### Alan tanımları
- **cast[]** — bu bölümde geçen karakterler.
  - `character_id`: slug (seri-düzeyi `characters` ile eşleşir/override eder).
  - `voice_id`: `"provider:voiceName"` (registry'den çözülür).
  - `base_style`: karakterin varsayılan sesi/tonu (her segmente miras).
- **segments[]** — üretimin sıralı birimleri.
  - `speaker`: cast'teki `character_id`.
  - `type`: `narration | dialogue | thought` (thought ileride farklı işlenebilir).
  - `text`: seslendirilecek Türkçe metin.
  - `style`: **segment-bazlı** duygu/ton, doğal dil (base_style'ı ezer/tamamlar).
  - `tags`: opsiyonel sağlayıcı işaretleri (ör. Gemini `[scared]`); non-deterministik.
  - `pause_after_ms`: segment sonrası eklenecek sessizlik (birleştirmede uygulanır).
- **pronunciations[]** — uydurma isim → telaffuz (Chirp custom pronunciation; Gemini prompt-içi ipucu).

### Sağlayıcıya göre kullanım (graceful degradation)
| Alan | Gemini 2.5 Flash | Chirp 3 HD | Azure MAI-Voice-2 |
|---|---|---|---|
| `style` (doğal dil) | prompt'a gömülür | ~kısıtlı | en yakın stil-enum'a eşlenir |
| `tags` | prompt işaretleri | yok sayılır | yok sayılır |
| `pause_after_ms` | birleştirmede | pause kontrol / birleştirme | birleştirme |
| `pronunciations` | prompt ipucu | custom pronunciation | SSML/lexicon |

## 7. TTS Adapter Arayüzü

```ts
interface ResolvedVoice { provider: string; providerVoice: string; }
interface TtsSegmentRequest {
  text: string; voice: ResolvedVoice; language: string;      // "tr-TR"
  style?: string; tags?: string[];
  pronunciations?: { term: string; sayAs: string }[];
}
interface TtsResult {
  audio: Buffer; format: 'mp3' | 'wav' | 'pcm';
  durationMs: number;
  cost: { unit: 'audio_tokens' | 'chars'; amount: number; usd?: number };
}
interface TtsAdapter {
  id: string;                                   // "gemini-2.5-flash-tts"
  synthesize(req: TtsSegmentRequest): Promise<TtsResult>;
  listVoices(): Promise<{ providerVoice: string; gender?: string }[]>;
}
```

- Adapter, sağlayıcıya özel çağrıyı, format dönüşümünü (gerekirse mp3'e), ve maliyet hesabını kapsüller.
- Worker adapter'ı `id` ile seçer (config); segment `provider` alanına yazılır.

## 8. Üretim Hattı & Job Yaşam Döngüsü & Hata Yönetimi

1. **Import:** `script_json` panele girer → zod ile doğrulanır → `segments` satırları materialize edilir → bölüm `script_ready`.
2. **Üret:** kullanıcı "Üret" → `job` oluşur, bölüm `queued`.
3. **Worker:** Postgres `jobs`'u poll eder → `queued` işi alır → bölüm `generating`.
4. **Segment üretimi:** her `pending` segment → registry'den ses çöz → adapter çağrısı → ses → Storage'a yükle → segment `done` (audio_url, duration_ms, cost).
5. **Idempotency & cache:** her segmentin `content_hash = hash(text, style, tags, voice, provider)`. Hash aynı + ses mevcutsa → **atla** (yeniden üretme yok, maliyet yok). Yalnızca değişen/başarısız segmentler üretilir.
6. **Retry:** başarısızlıkta exponential backoff (429 rate-limit farkında), max N deneme; hâlâ başarısızsa segment `failed`.
7. **Birleştirme:** tüm segmentler `done` → ffmpeg concat (+ `pause_after_ms` sessizlik) → `episode.mp3` → Storage → bölüm `ready`, `duration_ms` yazılır.
8. **Kısmi başarısızlık:** bir segment N denemeden sonra `failed` → job `failed`; panel hangi segmentin patladığını gösterir; "başarısızları yeniden dene" / "düzenle + yeniden üret".
9. **Maliyet takibi:** segment maliyetleri toplanır → bölüm/sezon/seri/toplam; panelde kalan kredi tahmini ile gösterilir.

**Chunking:** Segmentler zaten cümle/replik düzeyinde kısa (Gemini 32k token + "birkaç dakika sonra kalite kayması" kısıtına uyar). Aşırı uzun bir segment varsa cümle sınırından bölünür.

## 9. Panel (yönetim)
- **Kütüphane:** series/season/episode CRUD.
- **Bölüm editörü:** `raw_text` yapıştır · `script_json` import (zod doğrulama, hata gösterimi) · parse edilen segment/kadro önizleme.
- **Ses kadrosu (registry):** sesleri listele, karakterlere ata, örnek dinlet, `base_style` ayarla.
- **Üretim hattı monitörü:** job durumu · segment-bazlı durum ızgarası (pending/generating/done/failed) · canlı ilerleme (Supabase realtime veya poll) · hatalar · retry butonları · süre · **maliyet (segment/bölüm/toplam) + kalan kredi.**
- **Yeniden üretim:** segment/bölüm; segmentin text/style'ını düzenle → sadece onu yeniden üret (cache sayesinde ucuz).

## 10. Oynatıcı
- **Kütüphane:** series→season→episode, kapak, ilerleme rozetleri.
- **Kontroller:** play/pause/seek, hız (0.75–2x), ±15sn atla, bölüm listesi, **kaldığın yerden devam** (pozisyon Postgres'te saklanır), sonraki bölüme otomatik geç.
- **PWA:** kurulabilir (manifest + service worker) · **MediaSession API** (kilit ekranı/arka plan kontrolleri) · (Faz 1.5+) `episode.mp3` offline indirme.

## 11. Faz Planı & Milestones
- **Milestone 0 — Bake-off dilimi (ilk iş):** minik JSON script → Gemini 2.5 Flash TTS → ses dosyası → **dinle**. Türkçe doğallık + duygu + fantastik isim telaffuzunu gerçek çıktıyla doğrula. Beğenilmezse adapter üzerinden Chirp/Azure dene.
- **Faz 1 — MVP:** Supabase şema (+RLS) · Next.js (auth, series/season/episode CRUD, script import, voice registry) · worker (Gemini adapter, segment üretim, ffmpeg birleştirme, retry, cache, maliyet) · pipeline monitör · oynatıcı (kütüphane, playback, resume, PWA). Elle (Claude) analiz. **Hedef: uçtan uca tek bölüm → telefonda dinle.**
- **Faz 2 — Ölçek & Otomasyon:** otomatik LLM annotator (aynı JSON şemasını üretir) · toplu arşiv import · batch/long-audio üretim · gelişmiş maliyet kontrolleri. Ölçekte batch fiyat veya tutarlılık için Chirp 3 HD opsiyonu.

## 12. Teknoloji Stack
- **Web:** Next.js (App Router) + TypeScript. VPS'te Node.
- **Backend:** Supabase (Postgres + Auth + Storage), Supabase JS client, RLS.
- **Worker:** Node/TS, ayrı süreç (PM2 veya Docker Compose). Postgres job poll.
- **Ses:** ffmpeg (birleştirme/sessizlik/format).
- **TTS SDK:** `@google/genai` (Gemini API).
- **Doğrulama:** zod (JSON script şeması + API sınırları).
- **UI:** React + Tailwind (+ shadcn/ui). Görsel yön sonra `frontend-design` ile.

## 13. Test / Doğrulama
- **Adapter:** mock sağlayıcı ile unit test; JSON script şema contract testi (zod).
- **Pipeline:** mock adapter ile integration test → gerçek API maliyeti olmadan segment→birleştirme→Storage akışı.
- **Milestone 0:** gerçek Türkçe kaliteyi ampirik doğrular.
- **Player:** manuel + temel e2e (playback, resume).

## 14. Maliyet Modeli & Krediler
- **Gemini native TTS = SÜRE bazlı** (25 token/sn). 2.5 Flash ≈ $0.90/ses-saati (std), ~$0.45 (batch). Faz 1 (akış) pratikte bedava (kredi karşılar), throughput yüksek (paid tier).
- **Chirp 3 HD = karakter bazlı** ($30/1M): ~$0.60/bölüm; 1000 bölüm ≈ $570. Tutarlılık + telaffuz avantajı.
- **Krediler:** Google free-trial + ~$8 prepay. Kredi hem Gemini API hem Cloud/Vertex'e uygulanır (ilk testte bakiye düşüşü izlenerek doğrulanacak). Free-trial miktarı + son kullanma tarihi Faz 2 planı için netleştirilecek (açık soru).
- **Panel maliyet takibi** her üretimde gerçek tüketimi kaydeder.

## 15. Açık Sorular / Riskler
1. **Türkçe doğallık (BLOKLAYICI risk):** Hiçbir kaynak kanıtlamıyor → Milestone 0 bake-off ile ampirik doğrulanacak. Adapter swappable olduğu için risk yönetilebilir.
2. **Gemini duygu-etiketleri Türkçe'de:** dokümanlar İngilizce-merkezli + non-deterministik → Milestone 0'da test; yetersizse Azure (doğrulanmış Türkçe duygu ama `angry/whispering/sarcastic` yok) değerlendirilir.
3. **Kredi miktarı + son kullanma tarihi:** kullanıcı Billing → Credits'ten netleştirecek; Faz 2 zamanlamasını etkiler.
4. **ToS / Hukuk:** Telifli web novel'in kişisel-kullanım seslendirmesi + kendi içerik + ticari kullanım/ses sahipliği → araştırmada doğrulanmış iddia yok; kişisel kullanım varsayımıyla ilerleniyor, ileride netleştirilecek.
5. **Rate limit / max girdi / format / long-audio:** sağlayıcı sınırları implementasyonda doğrulanacak (adapter seviyesinde).
6. **Voice consistency (Gemini):** binlerce ayrı çağrıda ses kimliği kayması olabilir → Chirp 3 HD (deterministik) Faz 2 alternatifi.

## 16. Referanslar
- Araştırma raporu: `docs/research/2026-07-13-tts-provider-research.md`
- Gemini API speech: https://ai.google.dev/gemini-api/docs/speech-generation
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Cloud TTS Chirp 3 HD: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- Azure Speech language support: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
