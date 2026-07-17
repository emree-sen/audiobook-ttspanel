# Panel — Dilim C1: Üretim Hattı (Kuyruk + Cache + Preflight + Kota)

> Tarih: 2026-07-17 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: Dilim A/B spec'leri, UI redesign spec'i (görsel sistem miras alınır). C2 (sağlayıcı ekosistemi: OpenAI-uyumlu + Piper adapter'ları, ayarlar ekranı, sağlayıcı-bazlı ses havuzu) AYRI dilimdir.

## 1. Amaç

TTS üretimini kırılgan istek-içi akıştan **DB-destekli, kotaya-duyarlı bir üretim hattına** taşımak:

- **Preflight:** üretime başlamadan "N segment · M önbellekte · K yeni çağrı · bugünkü hak X/Y" panelde görünür (kullanıcı kararı 2026-07-17: sınırlı haklı kullanıcı kotasını böyle yönetir).
- **Kota defteri:** her gerçek API çağrısı kayda geçer; sağlayıcı-gün bazında sayaç.
- **Kota yetmezse kullanıcı seçer:** "İlk K'yı üret (kalan kuyruğa)" / "Yine de hepsini dene".
- **Content-hash cache:** değişmeyen segment bir daha TTS'e gitmez.
- **Segment-başı ses dosyaları + tek-segment yeniden üretme** (1 çağrı + hızlı yeniden birleştirme).
- **İş sürekliliği:** üretim tarayıcıdan bağımsız sürer; SSE yalnız izleyicidir; sunucu yeniden başlarsa iş kaldığı yerden devam eder.

## 2. Veri modeli (drizzle migrasyonu 0002)

```
jobs:        id pk · chapter_id fk(cascade) · script_id fk(cascade) · status (queued|running|done|error|canceled)
             · limit_calls int null (kısmi üretim tavanı; null=sınırsız) · done_count int default 0 · total_count int
             · error text null · created_at · updated_at
tts_calls:   id pk · provider text · model text · day text ("YYYY-MM-DD", sağlayıcının sıfırlanma dilimine göre)
             · segment_id text null · ok int (0/1) · usd real default 0 · created_at
             · index (provider, day)
audio_cache: hash pk (sha256: provider|model|voice|style|language|text) · path text (audioDir'e göreli)
             · duration_ms real · usd real · created_at
```

- `segments.contentHash` artık dolu tutulur (üretimde hesaplanıp yazılır); `segments.audioPath` segment dosyasına işaret eder.
- Segment dosyaları: `data/audio/segments/<hash>.wav` (cache ile aynı dosya — cache path'i budur). Bölüm mp3'leri eskisi gibi `data/audio/<chapterId>/<renderId>.mp3`.
- Bir bölümde aynı anda tek aktif iş (queued|running) olabilir; yenisi istenirse eski `canceled`.

## 3. Kota katmanı

- `lib/services/quota.ts`: `recordCall(db, {provider, model, segmentId, ok, usd})` · `usedToday(db, provider): number` · `quotaLimit(db, provider): number | null` (settings `quota_limit_<provider>`; gemini varsayılan **100**, mock için limit yok) · `remainingToday(db, provider)`.
- **Gün hesabı sağlayıcıya göre:** gemini → **America/Los_Angeles** (kota gece PT sıfırlanır; `Intl.DateTimeFormat` ile TZ dönüşümü, ek bağımlılık yok); diğerleri → UTC.
- Defter **gerçek** çağrıları sayar (retry/fallback dahil — adapter'ın her `synthesize` içindeki gerçek HTTP denemesini değil, `synthesize` çağrısını 1 sayarız; bkz. §9 dürüstlük notu).

## 4. Preflight

- `lib/services/preflight.ts`: `preflightChapter(db, chapterId): { total, cached, newCalls, quota: { provider, used, limit, remaining } | null, fits }`
  - En güncel script'in segmentlerinden hash hesaplar (aktif ses/model/single_voice ayarlarıyla), `audio_cache`'e bakar: `cached` = isabet sayısı, `newCalls = total - cached`.
  - `fits = quota.limit == null || newCalls <= remaining`.
- `GET /api/chapters/[id]/preflight` → yukarıdaki nesne. Üretim kartında her zaman görünür; script/ayar değişince tazelenir.

## 5. İş (job) yürütme

- `lib/services/producer.ts` — süreç-içi tek worker:
  - `enqueueJob(db, chapterId, { limitCalls? }): Job` — bölümün aktif işi varsa onu iptal edip yenisini kuyruklar; `total_count` = önbellekte olmayan segment sayısı dahil toplam segment.
  - `runNextJob(db, adapter)` / `ensureWorker()` — kuyruktan işi alır, segment segment yürütür:
    1. Hash hesapla → `audio_cache` isabet: dosyayı segmentin `audioPath`'ine bağla, `status='done'` (çağrı YOK, deftere yazılmaz).
    2. Iskalarsa: kota kontrolü (`remainingToday`); hak bittiyse veya `limit_calls` tavanına gelindiyse iş `queued`'a döner (`error=null`, kalanlar `pending`), çıkış — "devam et" aynı işi sürdürür.
    3. Adapter `synthesize` → deftere kayıt (ok/usd) → wav'ı `segments/<hash>.wav`e yaz, cache satırı ekle, segment `done`.
    4. Segment hatasında: segment `failed` + error, iş sürer (Dilim A davranışı korunur).
  - İş sonunda: `done` olan segment dosyalarından bölüm mp3'ü birleştirilir (core `concatSegmentsToWav`+`wavToMp3`; `pauseAfterMs` korunur), `renders` satırı, chapter `done|error` (hiç segment yoksa error).
  - **Resume:** sunucu açılışında (ilk `getDb()` sonrası lazy) `running` kalmış işler `queued`'a düşürülür; worker bir sonraki tetikte devam eder. Worker tetikleri: enqueue, "devam et", sunucu açılışı.
- `src/core` DEĞİŞMEZ: adapter'lar ve stitch fonksiyonları aynen import edilir; bölüm-düzeyi orkestrasyon (`generateEpisode`) CLI'da kalır, panel artık kendi segment-düzeyi hattını kullanır.

## 6. API

- `GET /api/chapters/[id]/preflight` → §4 nesnesi.
- `POST /api/chapters/[id]/generate` gövde `{ limitCalls?: number }` → iş kuyruklar, `{ jobId }` döner (SSE DEĞİL artık).
- `GET /api/chapters/[id]/progress` → **SSE izleyici:** `progress {done, total, status}` (DB'den; 500ms aralıkla) · `done {renderId, failedCount, ...}` · `paused {reason: 'quota'|'limit', done, total}` · `error {message}`. Bağlantı kopması işi ETKİLEMEZ; yeniden bağlanılabilir.
- `POST /api/jobs/[id]/resume` → duraklamış (queued, kısmen bitmiş) işi sürdürür.
- `POST /api/segments/[id]/regenerate` → tek segment: cache'i atla (hash'i sil/üzerine yaz), 1 çağrı, dosyayı değiştir, bölümü yeniden birleştir (yeni render). Yanıt `{ renderId }`.
- Annotate SSE'si (LLM) olduğu gibi kalır (C1 kapsamı TTS hattı).

## 7. UI (çalışma alanı, Üretim kartı)

- **Preflight satırı** (her zaman): "87 segment · 40 önbellekte · 47 yeni çağrı · Gemini bugün 63/100". Kota göstergesi ilerleme çubuğu minik varyantı.
- `fits=false` ise Üret düğmesi ikiye ayrılır: "**İlk 37'yi üret**" (limitCalls=remaining) / "Yine de hepsini dene" (ghost).
- Üretim ilerlemesi progress-SSE'den; iş `paused` olursa amber bilgi + "**Devam et**" düğmesi (yarın kota açılınca).
- Segment tablosuna iki ikon: ▶ (segment sesini çal — `audioPath` üzerinden `/api/audio/...`) ve 🔁 (yeniden üret; busy kilidi + 1 çağrı uyarısı).
- Cache'ten gelen segmentlerde küçük "önbellek" rozeti.

## 8. Test stratejisi (mock adapter, ağ yok)

- quota: kayıt + gün bucket'ı (PT sınırı — sabit timestamp'lerle), limit okuma (settings + varsayılan), remaining.
- preflight: boş cache → newCalls=total; kısmi cache; single_voice etkisi hash'e yansır; fits hesabı.
- producer: tam üretim (dosyalar + cache satırları + render + statüler); cache isabetli ikinci üretim → 0 çağrı; limitCalls ile duraklama + resume ile tamamlama; kota biterse duraklama; segment hatası → failed + iş sürer; running→queued resume (restart simülasyonu).
- regenerate: 1 çağrı, dosya değişimi, yeni render, diğer segmentlere çağrı yok.
- API: preflight/generate/progress(ilk olaylar)/resume/regenerate rotaları; progress SSE'nin işten bağımsızlığı (iş bitmişse done anında gelir).
- Mevcut 101 test yeşil kalır.

## 9. Riskler / dürüstlük notları

- **Preflight "en az" tahmindir:** Gemini adapter'ı içeride retry + stilli→düz fallback yapar; kötü günde 1 segment birden çok HTTP denemesi harcayabilir. Gösterge "K yeni çağrı" der, defter `synthesize` başına 1 sayar — Google tarafındaki sayaçla nadiren küçük sapma olabilir; limit ihtiyatlı yönetilmeli (belgede not edilir).
- **Tek worker / tek süreç:** self-host tek kullanıcı varsayımı; çoklu Next instance'ı desteklenmez (belgelenir).
- **WAL + eşzamanlılık:** worker ile istekler aynı better-sqlite3 bağlantısını paylaşır (senkron; sorun beklenmez).
- **Disk büyümesi:** segment cache sınırsız büyür; temizlik/GC C2+ konusu (belgelenir).
- Eski `generateChapter` panel servisi producer'la değiştirilir; testleri de yeni akışa taşınır (davranış sözleşmeleri korunarak).
