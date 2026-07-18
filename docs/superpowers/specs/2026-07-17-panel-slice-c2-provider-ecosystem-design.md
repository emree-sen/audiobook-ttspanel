# Panel — Dilim C2: Sağlayıcı Ekosistemi (OpenAI-uyumlu + Piper + Ayarlar Ekranı)

> Tarih: 2026-07-17 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: C1 spec'i (preflight/kota/cache bu dilimde yeni sağlayıcılara genellenir), Dilim B (ses havuzu genellemesi annotation'ı etkiler), UI redesign (görsel sistem miras).

## 1. Amaç

TTS'i tek sağlayıcıdan (Gemini) **takılabilir bir ekosisteme** taşımak:

- **OpenAI-uyumlu endpoint adapter'ı** — hem OpenAI TTS'in kendisi hem lokal sunucular (AllTalk, openedai-speech, LocalAI...). Kullanıcı URL + anahtar + model girer.
- **Piper yerleşik lokal TTS** — ücretsiz, CPU, Türkçe sesler. Kullanıcı piper.exe'yi kurar, panele exe yolu + `.onnx` model dosyalarını tanıtır (kurulum README'ye yazılır; otomatik indirme YOK — kullanıcı kararı 2026-07-17).
- **Ayarlar ekranı** (`/settings`) — sağlayıcı seçimi, bağlantı/anahtar/yol yapılandırması, ses havuzu yönetimi, kota limitleri, LLM ayarları.
- **Sağlayıcı-bazlı ses havuzu** — DB'de düzenlenebilir; Dilim B otomatik ses ataması her sağlayıcıda çalışır.
- **Adapter yetenek bildirimi** — stil desteklemeyen sağlayıcıda stiller sessizce düşer + panelde bilgi notu.

Kullanıcı kararları (2026-07-17): Piper = kullanıcı kurar, yol verir · sağlayıcı seçimi **global tek aktif** · ses havuzu **DB'de düzenlenebilir** · anahtarlar **DB + env fallback** (maskeli) · ayarlar ekranı çekirdek + kota limitleri + LLM ayarları (varsayılan anlatıcı sesi UI'sı KAPSAM DIŞI) · stil düşer + bilgi notu · mimari **karma**: Gemini/Piper/Mock sabit yuva, OpenAI-uyumlu için adlandırılmış bağlantılar.

## 2. Veri modeli (drizzle migrasyonu 0003)

```
tts_connections: id pk (kullanıcı slug'ı, ^[a-z0-9-]+$; rezerve: gemini|piper|mock|openai)
                 · label text · base_url text · api_key text null (lokal sunucularda anahtarsız)
                 · model text · created_at · updated_at
voices:          id pk · provider text (gemini | piper | <bağlantı slug'ı>) · voice text
                 · gender text ('male'|'female'|'' bilinmiyor) · tone text · path text null (yalnız Piper: .onnx yolu)
                 · created_at · unique(provider, voice)
```

- **Slug = sağlayıcı adı**: ses kimlikleri (`alltalk-lokal:alloy`), kota defteri (`tts_calls.provider`) ve cache hash'i bu ada göre ayrışır — iki farklı sunucunun aynı model+ses adları asla karışmaz. Bağlantı silinince voices satırları da silinir (uygulama kodunda); tts_calls/audio_cache tarihsel kayıt olarak kalır.
- **Tohum**: migration Gemini'nin mevcut 8 sesini (`lib/voices-pool.ts` içeriği) voices tablosuna yazar. OpenAI-uyumlu bağlantı için ayarlar ekranında "Resmî OpenAI seslerini ekle" düğmesi (alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer — hepsi gender:'' nötr; kullanıcı düzenler).
- **Yeni ayar anahtarları** (settings tablosu): `piper_exe` (exe yolu) · `gemini_api_key` (DB + env `GEMINI_API_KEY` fallback; TTS ve LLM aynı anahtarı paylaşır). Mevcut `provider`, `model`, `quota_limit_<provider>`, `llm_provider`, `llm_model` aynen kullanılır (`provider` artık slug da olabilir).

## 3. Adapter katmanı (`src/core/tts/` — EKLEME; mevcut davranış değişmez)

- `types.ts`'e **opsiyonel** alan: `TtsAdapter.capabilities?: { style: boolean }`. `undefined` = stil destekli sayılır (Gemini/Mock mevcut davranışı bozulmaz; Gemini/Mock'a açıkça `{ style: true }` eklenir — tek satırlık additive değişiklik, izinli istisna).
- **`openai.ts` — OpenAiCompatAdapter**: `POST {baseUrl}/audio/speech` gövde `{ model, voice, input, response_format: 'wav' }`; `api_key` varsa `Authorization: Bearer`. Yanıt binary wav → `durationMs` wav başlığından hesaplanır. Maliyet: `{ unit: 'chars', amount: text.length, usd: 0 }`. `capabilities: { style: false }`. Hata: HTTP durum + gövde özeti Türkçe mesajla sarılır; retry YOK (lokal sunucular hızlı-başarısız; Gemini'deki retry oradaki preview kırılganlığına özel).
- **`piper.ts` — PiperAdapter**: constructor `{ exePath, models: Record<voiceName, modelPath>, runProcess? }` — `runProcess` enjekte edilebilir çocuk-süreç sarmalayıcısı (varsayılan `execFile`; testler stub'lar, gerçek exe gerekmez). Çağrı: `exePath --model <path> --output_file <tmp.wav>`, metin stdin'den; tmp dosya okunur ve silinir. Bilinmeyen ses adı → net hata. `capabilities: { style: false }`. Maliyet: chars/usd 0.
- **`adapterFromSettings` (lib/services/generation.ts) genişler**: `mock`/`gemini` mevcut (gemini anahtarı artık `getSetting('gemini_api_key') ?? env`); `piper` → `piper_exe` + voices tablosundan (provider='piper') ad→path haritası kurulur; diğer değerler → tts_connections satırı aranır, yoksa Türkçe hata. Core DB bilmez — panel haritayı/konfigi kurar, constructor'a verir.

## 4. Yetenek bildirimi: stil düşürme + hash

- Aktif adapter `capabilities.style === false` ise: **synthesize isteğine style/tags konmaz VE segment hash'i stilsiz hesaplanır** (`style=''`, `tags=''`) — böylece cache anahtarı gönderilen içerikle birebir kalır, stilli script ile stilsiz script aynı sağlayıcıda aynı cache'i paylaşır.
- `preflightChapter` yanıtına `supportsStyle: boolean` eklenir. UI: script'te en az bir stilli/tag'li segment varsa ve `supportsStyle=false` ise preflight satırının altında bilgi notu: "Bu sağlayıcı stil desteklemiyor — segmentler düz okunur."
- Hash/stil kararının tek kaynağı preflight'taki plan fonksiyonudur; producer aynı planı kullanır (C1'deki gibi) — çifte mantık yok.

## 5. Ses havuzu genellemesi

- `lib/voices-pool.ts`: sabit `VOICE_POOL` yerine `loadPool(db, provider): PoolVoice[]` (voices tablosundan). `pickVoice(pool, gender, used)` — mantık aynı, havuz parametre olur. Sabit Gemini listesi yalnız migration tohumu olarak kalır.
- Varsayılan anlatıcı: `default_voice` ayarı → yoksa aktif sağlayıcının havuzundaki ilk ses. Havuz boşsa annotation net hatayla durur: "Aktif sağlayıcının ses havuzu boş — Ayarlar'dan ses ekleyin." (Varsayılan ses seçimi UI'sı kapsam dışı; ayar DB/env'den değişir.)
- Annotation (Dilim B) `loadPool` kullanır; ses kimlikleri `<provider>:<voice>` biçiminde üretilir (mevcut parse değişmez).

## 6. Ayarlar ekranı (`/settings`)

Sidebar'ın altına "Ayarlar" bağlantısı (dişli ikon). Sayfa kartları:

1. **Aktif sağlayıcı** — açılır liste: Gemini · Piper · <bağlantılar> · Mock.
2. **Gemini** — API anahtarı (maskeli giriş; değer env'den geliyorsa "env'den" rozeti) + model alanı (settings `model`).
3. **OpenAI-uyumlu bağlantılar** — liste (slug, URL, model) + yeni bağlantı formu (slug/label/URL/anahtar/model) + sil (ConfirmButton). Bağlantı seçilince ses havuzu bölümü: ses ekle (ad + cinsiyet + ton), sil, "Resmî OpenAI seslerini ekle".
4. **Piper** — exe yolu + model listesi: .onnx yolu ekle → ses adı dosya adından türetilir (ör. `tr_TR-fahrettin-medium`), cinsiyet/ton düzenlenebilir, sil.
5. **Gemini ses havuzu** — aynı ekle/sil/düzenle deseni.
6. **Kota limitleri** — sağlayıcı başına günlük çağrı limiti girişi (boş = limitsiz; gemini varsayılan 100 gösterilir).
7. **LLM (annotation)** — sağlayıcı (gemini/mock) + model.

### API

- `GET /api/settings` — tüm ayarlar + bağlantılar + havuzlar tek yanıtta; **anahtarlar maskeli** (son 4 karakter). `PUT /api/settings` — kısmi güncelleme; maskeli/boş bırakılan anahtar alanı DEĞİŞMEZ, silmek için açık `null`.
- `POST/DELETE /api/connections`, `POST/DELETE/PATCH /api/voices` — CRUD; slug/format zod doğrulaması, Türkçe hatalar.
- Auth: mevcut middleware kapsar; ek bir şey gerekmez.

## 7. Kota entegrasyonu

- `quotaLimit`: mevcut `quota_limit_<provider>` düzeni slug'larla da çalışır; varsayılan yalnız gemini=100, diğerleri null (limitsiz). Piper lokal — pratikte limitsiz ama kullanıcı isterse limit girebilir (aynı mekanizma).
- Preflight satırındaki "X bugün Y/Z" göstergesi aktif sağlayıcının adını zaten dinamik basıyor; limitsiz sağlayıcıda kota bölümü gizli (C1 davranışı: quota null).

## 8. Test stratejisi (ağ yok, gerçek exe yok)

- **openai adapter**: fetch stub — istek gövdesi/başlık doğrulama, wav yanıt → durationMs, anahtarsız istek, HTTP hata mesajı.
- **piper adapter**: `runProcess` stub — arg kurgusu, stdin metni, tmp wav okuma/silme, bilinmeyen ses hatası.
- **connections/voices servisleri**: CRUD, slug doğrulama, rezerve ad reddi, bağlantı silince havuz temizliği.
- **settings API**: maskeleme, maskeli değerin yazılmaması, null ile silme.
- **preflight/producer**: `supportsStyle=false` → stilsiz hash + synthesize'a stil gitmez; stilli/stilsiz script aynı hash.
- **annotation**: havuz DB'den; boş havuz hatası.
- **adapterFromSettings**: slug → bağlantı, piper → harita, bilinmeyen sağlayıcı hatası.
- Mevcut 123 test yeşil kalır; UI birim testi yok (mevcut kalıp) — headless smoke + kullanıcı görsel onayı.

## 9. Riskler / dürüstlük notları

- **OpenAI-uyumluluk bir spektrumdur**: bazı sunucular `response_format:'wav'` desteklemez (yalnız mp3) — kapsam dışı, README'ye yazılır; ilk gerçek ihtiyaçta format alanı eklenir.
- **Piper süreç maliyeti**: her segment bir süreç başlatır; CPU'da uzun bölüm yavaş olabilir (lokal ve bedava — kabul edilir). Çok-konuşmacılı Piper modelleri desteklenmez (tek-konuşmacılı Türkçe modeller hedef).
- **Anahtar DB'de düz metin** durur (SQLite lokal, `data/` git-ignore; tek-sahip self-host varsayımı). Maskeli GET dışa sızdırmaz.
- **`src/core` istisnası**: types.ts'e opsiyonel alan + Gemini/Mock'a birer satır `capabilities` — additive, mevcut 23 çekirdek test değişmeden yeşil kalmalı; başka core değişikliği YASAK.
- Sağlayıcı değişince eski sağlayıcının segment durumları `done` görünür ama preflight yeni sağlayıcıya göre "yeni çağrı" sayar (hash farklı) — doğru davranış, kafa karışıklığını preflight satırı çözer.
- **Son inceleme sertleştirmeleri (2026-07-18):** preflight artık `providerMismatch` uyarısı gösteriyor (script başka sağlayıcı için annotate edilmişse üretimden önce uyarır, kota israfını önler); bağlantı sağlayıcılarında hash'in model bileşenine `baseUrl` katılır (aynı slug farklı sunucuya yeniden bağlanırsa eski cache artık sunulmaz).

## 10. Kapsam dışı

CLI'ya yeni sağlayıcı bayrakları · yalnız-mp3 sunucular · Piper çok-konuşmacılı/otomatik indirme · ses önizleme ("sesi dene") · varsayılan anlatıcı sesi UI'sı · cache GC · sağlayıcı sağlık kontrolü (ping) ekranı.
