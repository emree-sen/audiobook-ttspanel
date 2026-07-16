# Panel — Dilim A: İskelet + Veri Katmanı + Dikey Dilim

> Tarih: 2026-07-16 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: `2026-07-13-webnovel-tts-design.md` (çekirdek/şema), `CLAUDE.md` (proje durumu)

## 1. Bağlam ve ürün vizyonu

Web novel'leri duygu-duyarlı, çok-sesli seslendiren **self-host, açık kaynak (public GitHub repo)** bir sesli-kitap üretim & dinleme panelidir. Kullanıcı kendi sunucusuna/lokaline kurar, **kendi API anahtarlarını getirir (BYO-key)**, maliyeti kendi öder.

**Tam ürün akışı (nihai vizyon):**
1. Kullanıcı bir **proje → bölüm** hiyerarşisinde metnini yapıştırır + **nasıl anlatılsın** (anlatım tarzı) belirtir.
2. Sistem, bağlı **LLM'le (Claude/GPT/…)** bu metni TTS'in anlayacağı yapılandırılmış bir **script**'e çevirir; kaç parçaya/isteğe bölündüğünü ve içeriği net gösterir; **düzenle + yeniden üret** mekanizması vardır.
3. **TTS üretimi**ne geçilir; çok-request'liyse akış ve mevcut aşama net görünür (ilerleme).
4. Üretilen ses aynı panelde görüntülenir; **segment yeniden üretme** ile düzeltilir.

Bu doküman yalnızca **Dilim A**'yı kapsar. B/C/D ayrı spec'lerdir (§9).

### 1.1 Bu belgeyle değişen önceki kararlar

Bu dilim, `CLAUDE.md`'deki iki kararı bilinçli olarak değiştirir (spec kabul edilince CLAUDE.md güncellenecek):

| Eski karar | Yeni karar | Neden |
|---|---|---|
| Barındırma: **Supabase Cloud** (Postgres·Auth·Storage) | **SQLite + yerel disk + tek-sahip auth** | Public self-host için sıfır dış-servis sürtünmesi; `git clone → npm run`. Drizzle ile ileride Postgres'e göç açık. |
| Analiz akışı: **hatta LLM yok, elle Claude** (Faz 1) | **LLM annotation panel içinde otomatik** (BYO-key, provider-agnostic) — *Dilim B'de* | Kullanıcı vizyonu: panel metni kendisi script'e çevirmeli. Zod script şeması sözleşme olarak korunur. |

## 2. Dilim A'nın kapsamı (YAGNI)

**Amaç:** çalışan bir dikey dilim — proje/bölüm/metin veri katmanı **+ mevcut `src/core` çekirdeğini bağlayıp gerçek ses üretimi.** Bugün CLI ile yapılan iş (JSON script → mp3) web'e taşınır. En riskli entegrasyon (çekirdek → web → ses depolama → tarayıcıda oynatma) erkenden doğrulanır.

**İçinde (A):**
- Next.js (App Router) + TypeScript iskeleti; mevcut `src/core` korunur ve import edilir.
- SQLite (Drizzle ORM) veri katmanı; §4'teki şema.
- Tek-sahip auth (env şifresi → imzalı cookie).
- Proje CRUD, bölüm CRUD (ham metin + anlatım tarzı alanı dahil).
- Bölüm çalışma alanı: **elle JSON script yapıştır → "Üret" → mevcut orkestratör mp3 üretir → SSE ilerleme → tarayıcıda dinle.**
- Başarısız segmentlerin işaretlenmesi (çekirdek zaten atlıyor) + tam yeniden çalıştırma.

**Dışında (sonraki dilimler):**
- **B:** LLM annotation (ham metin + tarz → script), chunk'lama, script düzenle & yeniden üret.
- **C:** Sağlam iş kuyruğu (DB-backed), content-hash cache, maliyet paneli, **tek-segment yeniden üretme** ve segment-başı ses dosyaları, RPM/RPD ilerleme paneli.
- **D:** Kütüphane + PWA oynatıcı (resume, MediaSession, offline).
- Çok-kullanıcı/RLS, hosted deploy, Settings ekranında şifreli anahtar saklama.

## 3. "Faz" modeli (UI sözleşmesi, tüm dilimler için)

İki seviyeli, panelde net görünen model:

- **Üst seviye — boru hattı aşamaları** (bölüm bunlardan birinde; ilerleme şeridi):
  `① Metin → ② LLM annotation → ③ Script inceleme/düzenleme → ④ TTS üretimi → ⑤ Birleştirme/dinleme`
- **Alt seviye — chunk ilerlemesi** (ağır iki aşamada):
  - **② LLM (Dilim B):** uzun bölüm N metin-parçasına bölünür → her parça 1 LLM isteği. "3 parçadan 2'si tamam", her parçanın çıktısı görünür/düzenlenebilir.
  - **④ TTS (Dilim A basit / C sağlam):** script'teki her segment 1 TTS isteği. "87 segmentten 40'ı üretildi", başarısız segment işaretli.

**Dilim A**, `chapters.status` ile üst-seviye aşamayı (`draft → scripted → generating → done|error`) ve TTS aşamasında SSE ile alt-seviye "done/total" segment ilerlemesini gösterir. LLM chunk'lama görünümü B'ye aittir.

## 4. Veri modeli (SQLite / Drizzle)

Tüm tablolar `id TEXT PRIMARY KEY` (uygulama tarafı üretilmiş kısa id), zaman damgaları epoch ms `INTEGER`. `scripts`/`segments`/`renders` şeması **ilk taslaktır**; B/C rafine edebilir.

```
settings(
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)   -- gizli-olmayan varsayılanlar: provider, model, single_voice, default_voice

projects(
  id, title TEXT NOT NULL, description TEXT NULL,
  created_at INT, updated_at INT
)

chapters(
  id, project_id → projects.id (ON DELETE CASCADE),
  position INT NOT NULL,               -- proje içi sıra
  title TEXT NOT NULL,
  raw_text TEXT NOT NULL DEFAULT '',
  narration_style TEXT NULL,           -- "nasıl anlatılsın" (B kullanacak; A'da saklanır)
  status TEXT NOT NULL DEFAULT 'draft',-- draft|scripted|generating|done|error
  created_at INT, updated_at INT
)

scripts(
  id, chapter_id → chapters.id (ON DELETE CASCADE),
  version INT NOT NULL,                -- düzenle&yeniden üret için artan
  source TEXT NOT NULL,                -- manual|llm  (A: manual)
  json TEXT NOT NULL,                  -- zod VoiceoverScript (doğrulanmış) JSON
  created_at INT
)

segments(
  id, chapter_id → chapters.id (ON DELETE CASCADE),
  script_id → scripts.id (ON DELETE CASCADE),
  idx INT NOT NULL,
  speaker TEXT NOT NULL, style TEXT NULL,
  text TEXT NOT NULL, voice TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|done|failed
  audio_path TEXT NULL,                    -- A'da NULL; segment-başı dosya C'de
  error TEXT NULL, content_hash TEXT NULL,
  created_at INT, updated_at INT
)

renders(
  id, chapter_id → chapters.id (ON DELETE CASCADE),
  script_id → scripts.id (ON DELETE CASCADE),
  path TEXT NOT NULL,                   -- birleştirilmiş mp3 (./data/audio/...)
  duration_sec REAL NULL,
  created_at INT
)
```

**Not (çekirdek gerçeği):** `generateEpisode()` şu an birleştirilmiş mp3'ü **bellekte** döndürür; segment-başı dosya yazmaz. Dilim A yalnızca **render** mp3'ünü diske yazar; `segments.audio_path` A'da `NULL` kalır, segment-başı ses dosyaları ve tek-segment yeniden üretme **Dilim C**'de eklenir.

## 5. Ekranlar / rotalar (Next.js App Router)

- `/login` — tek-sahip şifre formu.
- `/` — proje listesi (oluştur / yeniden adlandır / sil).
- `/projects/[id]` — proje içi bölüm listesi (oluştur / sırala / sil); her bölümde durum + aşama rozeti.
- `/chapters/[id]` — **çalışma alanı:**
  - Ham metin editörü + anlatım tarzı alanı (kaydet).
  - **Script paneli:** JSON script yapıştır → şema doğrulama (hatalar satır bazında gösterilir) → kaydet.
  - **"Üret"** düğmesi → SSE ile canlı segment ilerlemesi (done/total, başarısız işaretli).
  - **Oynatıcı:** üretilmiş render mp3'ünü `<audio>` ile dinle.
  - **Segment listesi:** idx · speaker · style · durum.

### API rotaları
- `POST /api/auth/login`, `POST /api/auth/logout`
- `GET/POST /api/projects`, `PATCH/DELETE /api/projects/[id]`
- `GET/POST /api/projects/[id]/chapters`, `GET/PATCH/DELETE /api/chapters/[id]`
- `PUT /api/chapters/[id]/script` — JSON'u zod ile doğrula, yeni `scripts` versiyonu + `segments` yaz.
- `POST /api/chapters/[id]/generate` — **SSE**; orkestratörü çalıştırır, ilerleme/olayları akıtır, `renders` + segment durumlarını yazar.
- `GET /api/audio/[...path]` — `./data/audio` altından mp3 servis eder (path traversal koruması).

## 6. Üretim akışı (Dilim A, basit/senkron)

1. "Üret" → sunucu ilgili bölümün en güncel `scripts.json`'unu okur, **mevcut zod şemasıyla** doğrular.
2. `settings`/`.env`'e göre adapter seçilir (`gemini` | `mock`); `single_voice` ayarı varsa uygulanır.
3. **Mevcut `generateEpisode(script, adapter, onProgress)`** çağrılır; `onProgress(done,total)` SSE'ye yazılır.
4. Dönen `EpisodeResult`: mp3 `./data/audio/<chapterId>/<renderId>.mp3` yazılır; `renders` satırı; `failed[]` segmentleri `segments.status='failed'`+`error` olarak işaretlenir; kalanlar `done`.
5. `chapters.status` → `generating` (başta) → `done` (mp3 varsa) / `error` (hiç segment üretilmediyse).
6. Ayrı worker yok — istek boyunca inline çalışır (self-host tek kullanıcı için yeterli). Sağlam DB-kuyruk, cache, maliyet **Dilim C**.

**Kısıt hatırlatması:** Gemini 3.1 TTS free-tier **günde 100 istek (RPD)** ve RPM throttle (adapter'da 6s) — uzun bölüm yarıda kalabilir; başarısız/atlanan segmentler işaretlenir, kullanıcı sonra yeniden çalıştırır. BYO **paid key** ile RPD yükselir (kullanıcının sorumluluğu).

## 7. Auth / config / yapı

- **Auth:** `middleware.ts` korumalı rotalarda imzalı httpOnly cookie kontrol eder; `/login` şifreyi `PANEL_PASSWORD` ile karşılaştırıp cookie set eder. Kullanıcı tablosu yok. `PANEL_PASSWORD` boşsa (lokal geliştirme) auth bypass — README'de uyarı.
- **`.env`:** `PANEL_PASSWORD`, `GEMINI_API_KEY` (ileride `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Veri dizini `./data` (git-ignore), DB `./data/app.db`, ses `./data/audio/`.
- **Çekirdek reuse:** `src/core` doğrudan import; `generateEpisode` imzası zaten uygun (`onProgress` var, mp3 Buffer döner). Gerekirse yalnızca ses **çıktı yolu** API tarafında yönetilir (çekirdek dosya yazmıyor, bu iyi).
- **Yapı:** Next uygulaması **repo kökünde** — `app/` (rotalar), `lib/db/` (Drizzle şema+migrasyon+istemci), `lib/auth/`, `lib/config.ts`; `src/core` korunur. Tek `package.json`. `type: module` mevcut, Next uyumlu.
- **Bağımlılıklar (yeni):** `next`, `react`, `react-dom`, `drizzle-orm`, `better-sqlite3` (+ `drizzle-kit`, tipler). Mevcut `@google/genai`, `zod`, `ffmpeg-static` korunur.

## 8. Test stratejisi

- **Mevcut 23 çekirdek testi yeşil kalır** (regresyon yok).
- **Veri katmanı:** Drizzle CRUD + cascade testleri (bellek-içi/temp SQLite).
- **API handler'ları:** `mock` adapter ile (ağ yok) — script doğrulama (geçerli/geçersiz JSON), generate akışı (segment durumları + render satırı), auth guard.
- **SSE:** generate rotasının olay sırası (progress → done) birim testi.
- Playwright uçtan-uca smoke: **ertelendi** (D veya ayrı iş).

## 9. Yol haritası (sonraki dilimler)

- **Dilim B — LLM annotation:** provider-agnostic LLM adapter (Claude+OpenAI), anlatım-tarzı → chunk'lama → zod script; chunk ilerleme UI; **script düzenle & yeniden üret.**
- **Dilim C — TTS üretim hattı:** DB-backed kuyruk, content-hash cache, maliyet, RPM/RPD ilerleme, **tek-segment yeniden üretme** + segment-başı ses dosyaları.
- **Dilim D — Kütüphane + PWA oynatıcı:** liste·oynat·resume·MediaSession·offline.

Her dilim kendi spec → plan → uygulama döngüsüne sahiptir; §4 şeması ve §3 faz modeli ortak sözleşmedir.

## 10. Açık riskler / notlar

- **better-sqlite3 native derleme:** Windows'ta prebuild genelde sorunsuz; README'de Node ≥20 notu. Sorun çıkarsa alternatif `node:sqlite` (Node 22+) değerlendirilir.
- **Uzun senkron generate:** RPD/RPM nedeniyle uzun sürebilir; A'da SSE ile canlı ilerleme yeterli, iptal/resume C'de.
- **Path traversal:** `/api/audio/[...path]` yalnızca `./data/audio` altını servis etmeli (normalize + prefix kontrol).
