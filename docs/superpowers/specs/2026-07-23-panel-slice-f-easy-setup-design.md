# Dilim F — Kolay Kurulum (preset + sına + tek komut + sidecar)

**Tarih:** 2026-07-23 · **Durum:** Onaylandı (tasarım)

## Amaç

Dilim E'nin lokal model akışındaki kurulum zahmetini (venv/pip, elle adres/port,
iki terminal) profesyonel projelerin kalıplarıyla kaldırmak: preset + bağlantı
sınama + otomatik algılama (A), XTTS için tek komut kurulum/başlatma (B),
panelden sidecar yönetimi (C). Kullanıcı seçimi: A+B+C; Docker compose VPS işine,
panelden ses wav yükleme backlog'a ertelendi.

## A) Ayarlar: preset + sına + algılama

- **Presetler:** LLM kartında "LM Studio" (`http://localhost:1234/v1`) ve "Ollama"
  (`http://localhost:11434/v1`) düğmeleri — adresi doldurur, sağlayıcıyı
  `openai-compat` yapar. Bağlantılar bölümünde "XTTS sunucusu" preset'i
  (`id: xtts`, `http://localhost:8020/v1`, model `xtts-v2`).
- **Sına:** `POST /api/probe` — gövde `{ kind: 'llm' | 'tts', baseUrl }`; fetch
  sunucu tarafında yapılır (CORS yok). LLM: `GET {base}/models`; TTS (XTTS):
  `GET {origin}/health`. Yanıt: `{ ok, detail }` (model sayısı / ses listesi /
  hata mesajı). Zaman aşımı ~3 sn.
- **Algılama:** Ayarlar sayfası açılışında aynı probe ile üç bilinen adres
  yoklanır; bulunanların preset düğmesinde "algılandı ●" rozeti. Arka plan
  taraması yok; yalnızca sayfa açılışı + elle sına.

## B) XTTS tek komut kurulum — `tools/xtts-server/run.sh`

- python3.11+ arar (`python3.11` → `python3.12` → `python3`; sürüm < 3.10 ise net
  hata), `.venv` yoksa oluşturur + `pip install -r requirements.txt`, `voices/`
  boşsa uyarı basar (sunucu yine açılır), sonra `python server.py "$@"` (argümanlar
  geçer: `--lang`, `--port`, `--device`).
- İkinci çalıştırma: `.venv` varsa kurulum adımları atlanır, doğrudan başlatır.
- `server.py`'ye `GET /health` eklenir: `{ status: 'ok', voices: [...], device }`.
  README'ler `./run.sh` tek satırına iner.

## C) Panelden sidecar yönetimi

- `lib/services/xtts-sidecar.ts`: modül-tekil süreç yöneticisi — `start()`
  (`run.sh`'ı spawn eder), `stop()`, `status()` (`stopped | starting | running |
  error`; çalışıyor bilgisi /health'ten), son ~50 log satırı halka tamponda
  (ilk kurulumdaki model indirmesi görünür olsun).
- `app/api/xtts/route.ts`: `GET` durum+log, `POST` başlat, `DELETE` durdur.
- Ayarlar'da "XTTS sunucusu" kartı: Başlat/Durdur + durum + log kuyruğu
  (çalışırken ~2 sn'de bir yenilenir).
- Sınır: yalnızca panel ile XTTS aynı makinedeyken anlamlı; uzak sunucu
  kullanan adresi elle girer. Panel süreci kapanınca sidecar da kapanır
  (detach yok). Tek örnek: zaten çalışıyorsa ikinci başlatma reddedilir.

## Sıra ve test

B → A → C (C, B'nin script'ine ve health probe'una yaslanır).

- Probe/xtts route birim testleri (fetch/child_process mock).
- `run.sh` sözdizimi `bash -n` ile; işlevsel doğrulama kullanıcının M4'ünde elle.
- UI metinleri i18n (TR/EN, parite testi).

## Kapsam dışı

Docker compose (VPS ile), panelden ses wav yükleme (backlog E maddesi),
Ollama model indirme yönetimi (Ollama kendi yapıyor), sidecar'ın panel dışında
yaşaması (launchd/systemd).
