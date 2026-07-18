# Panel — Dilim D: Kütüphane + PWA Oynatıcı

> Tarih: 2026-07-19 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: C1/C3 (renders + `voiced` durumu), C2 (ayarlar/sidebar), UI redesign (koyu stüdyo miras). Kullanıcı kararları 2026-07-19: ayrı `/library` sayfası · resume DB'de · indir-düğmeli tam offline · hız + 15/30 atlama + otomatik sonraki bölüm (uyku zamanlayıcısı YOK) · global alt çubuk oynatıcı.

## 1. Amaç

Üretilen bölümleri **dinleme deneyimine** dönüştürmek: kütüphane listesi, kaldığın yerden devam, kilit ekranı kontrolleri, telefon kurulumu (PWA) ve bağlantısız dinleme.

## 2. Veri modeli (drizzle migrasyonu 0004)

```
listening_progress: chapter_id pk (fk chapters cascade) · position_sec real · duration_sec real · updated_at
```

- Pozisyon **bölüme** bağlıdır (render'a değil): mp3 yeniden birleştirilse de kaldığın yer korunur (süre değişirse istemci pozisyonu `min(position, duration)`'a kıstırır).
- "Cihazlar arası" anlamı: panel tek sunucuda (hedef: VPS) barınır; tüm istemciler aynı SQLite'a yazar. İki bağımsız lokal kurulum arasında senkron YOKTUR (tüm veriler gibi).

## 3. API

- `GET /api/library` → `[{ project: {id, title}, chapters: [{ id, title, position, status, renderPath | null, durationSec | null, progressSec | null, updatedAt }] }]`
  - Yalnız `done` (son render'ıyla, oynatılabilir) ve `voiced` (oynatılamaz — "Birleştir bekliyor") bölümler döner; `draft/scripted/generating/error` kütüphanede görünmez.
  - Son render = `renders` içinde en yenisi (mevcut `listRenders` sırası).
- `PUT /api/progress/[chapterId]` gövde `{ positionSec: number, durationSec?: number }` → upsert, `{ ok: true }`. Doğrulama: sonlu, ≥ 0 sayılar; bilinmeyen bölüm 404.
- Servis: `lib/services/library.ts` — `getLibrary(db)`, `saveProgress(db, chapterId, {positionSec, durationSec?})`. Otomatik "sonraki bölüm" için ayrı servis YOK: kütüphane sayfası oynatıcıya serinin oynatılabilir bölümlerini **sıralı kuyruk** olarak verir; `ended`/önceki-sonraki kuyruktan yürür (offline'da da çalışır — plan aşaması kararı, 2026-07-19). "Devam et" seçimi: `updated_at` en yeni VE `positionSec < durationSec - 5` olan ilerleme kaydı.

## 4. Global oynatıcı (`lib/ui/player/`)

- **`PlayerProvider.tsx`** (client context, layout'a sarılır): durum `{ track: { chapterId, title, seriesTitle, src, durationSec } | null, playing, position, rate }`; tek `<audio>` elemanı burada yaşar — rota değişse ses kesilmez.
  - `playChapter(item)` API'si: kütüphane (ve istenirse bölüm sayfası) bunu çağırır.
  - **Resume**: parça açılırken `progressSec`'ten başlar (kütüphane yanıtından gelir; ayrı GET yok).
  - **Kaydetme**: çalarken ~5 sn'de bir + `pause`/`ended`/`visibilitychange(hidden)` anında `PUT /api/progress/...`; ağ hatası sessizce yutulur (dinleme kesilmez), sonraki tik tekrar dener.
  - **Hız**: 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 — `localStorage['wnt:rate']` (cihaz tercihi; DB'ye yazılmaz).
  - **Otomatik sonraki**: `ended` → kütüphane verisinden sıradaki `done` bölüm; yoksa durur.
  - **MediaSession**: metadata (bölüm adı + seri adı + uygulama ikonu), action handler'lar: play/pause/seekbackward(15)/seekforward(30)/previoustrack/nexttrack/seekto; `positionState` güncellenir.
- **`PlayerBar.tsx`**: alt sabit çubuk (track varken görünür; `/login`'de asla): başlık/seri · geri-15 · çal-duraklat · ileri-30 · sürüklenebilir ilerleme + süre · hız menüsü · sonraki. Mobilde tek satıra sığan kompakt düzen; koyu stüdyo token'ları.
- Layout: `app/layout.tsx` gövdesi `PlayerProvider` ile sarılır; `PlayerBar` en alta eklenir; içerik alt boşluğu çubuk yüksekliği kadar artar (çubuk görünürken).

## 5. `/library` sayfası

- Sidebar'a "Kütüphane" bağlantısı (kulaklık/çal ikonu) — Ayarlar bağlantısının üstüne.
- Düzen (mobil öncelikli): en üstte **"Devam et"** kartı (en son `updated_at`'li, bitmemiş ilerlemeli bölüm — tek dokunuşla kaldığı yerden); altında seri (proje) kartları → bölüm satırları.
- Bölüm satırı (`done`): ▶ oynat (aktif parçaysa eşitleyici animasyonu) · ilerleme yüzdesi/mini çubuk · süre · **İndir** (offline'a al) veya indirildiyse **✓ / Sil**.
- Bölüm satırı (`voiced`): soluk, "Birleştir bekliyor" notu + bölüm sayfasına link (oynatılamaz).
- Offline durumdayken: `/api/library` cache fallback'ten gelir; yalnız **indirilmiş** bölümler oynatılabilir işaretlenir (Cache API'den `wnt-audio` anahtarları sorgulanır), kalanlar soluk.

## 6. PWA + offline

### 6.1 Manifest + kurulum
- `public/manifest.webmanifest`: `name: "webnovel-tts"`, `start_url: "/library"`, `display: "standalone"`, `background_color/theme_color: "#0f1115"`, ikonlar: **SVG** (any + maskable; dalga-formu marka — PNG üretim bağımlılığı eklenmez; risk §8).
- `app/layout.tsx` head: manifest linki + `theme-color` meta; SW kaydı küçük bir client bileşeninde (`lib/ui/player/RegisterSw.tsx`): `navigator.serviceWorker.register('/sw.js')` (yalnız üretim build'inde; dev'de kayıt atlanır — HMR çakışması).

### 6.2 Service worker (`public/sw.js`, elle yazılmış — workbox YOK)
- **Navigasyon** istekleri: network-first; başarılı `/library` HTML'i `wnt-shell` cache'ine yazılır; offline'da bu kabuk döner (diğer rotalar offline'da da `/library` kabuğuna düşer — SPA hidrasyonu içerikten gelir).
- **`/_next/static/`**: cache-first (`wnt-static`) — hash'li, güvenle bayatlamaz.
- **`/api/audio/`**: cache-first (`wnt-audio`); cache'te yoksa network. **Range desteği ŞART**: istekte `Range` başlığı varsa cache'teki tam yanıttan dilim kesilip `206 Partial Content` (`Content-Range` ile) döner — yoksa offline seek ve iOS çalma kırılır.
- **`/api/library`**: network-first; başarılı yanıt `wnt-meta` cache'ine; offline'da cache fallback.
- Diğer tüm istekler: dokunulmaz (network).
- Sürümleme: `const VERSION = 'v1'` — cache adları versiyonlu; `activate`'te eski sürümler temizlenir.

### 6.3 İndirme yönetimi (istemci tarafı, `lib/ui/player/offline.ts`)
- `downloadChapter(renderPath)`: `fetch('/api/audio/'+renderPath)` → `caches.open('wnt-audio').put(...)`. Oturum açıkken çalışır (cookie ile); indirilen içerik cihazda şifresiz durur (tek-sahip, kabul — §8).
- `isDownloaded(renderPath)`, `removeDownload(renderPath)`, `downloadedList()` — cache anahtarlarından türetilir; ekstra kayıt tutulmaz.
- Kütüphane başlığında kapladığı alan: `navigator.storage.estimate()` (destekleyen tarayıcılarda).

### 6.4 Auth etkileşimi
- `middleware.ts` PUBLIC listesine eklenir: `/manifest.webmanifest`, `/sw.js`, `/icons/` (kurulabilirlik + SW kaydı auth'suz erişim ister). Sayfalar, API ve ses AUTH'LU kalır; offline çalma cache'ten cookie'siz çalışır.

## 7. Test stratejisi

- Servis: `getLibrary` (yalnız done+voiced; son render; progress join), `saveProgress` (upsert, kıstırma yok — istemci işi), `nextPlayable` (sıra, done-atlama, seri sonu null).
- API: library/progress rotaları (doğrulama, 404, upsert).
- SW/oynatıcı/PWA: birim test altyapısı yok (repo kalıbı) — `npm run build` + manuel doğrulama listesi: kurulum (Android Chrome), kilit ekranı kontrolleri, hız/atlama, otomatik sonraki, resume (cihazlar arası — aynı sunucu), İndir → uçak modu → çalma + seek, Sil.
- Mevcut 193 test yeşil kalır.

## 8. Riskler / dürüstlük notları

- **iOS Safari PWA**: arka plan/kilit ekranı çalma ve MediaSession desteği kısıtlı olabilir; SW cache kotası düşük. Bilinen platform sınırı — Android birincil hedef, iOS "çalışırsa bonus".
- **SVG manifest ikonu** çok eski Android sürümlerinde görünmeyebilir; gerekirse PNG'ler sonradan eklenir (bağımlılıksız üretim şu an yok).
- **İndirilen ses cihazda korumasız** (Cache Storage) — tek-sahip self-host varsayımıyla kabul.
- **Range-slice** implementasyonu sw.js'in en riskli parçası; manuel doğrulama listesinde offline seek açıkça test edilir.
- `renders` birikmeye devam eder (GC hâlâ kapsam dışı); kütüphane yalnız SON render'ı kullanır.

## 9. Kapsam dışı

Uyku zamanlayıcısı · push bildirim · Background Sync · indirme kuyruğu/toplu indirme · cache GC · çoklu kullanıcı profili · bölüm içi zaman damgalı yer imleri · app-shell tam precache.
