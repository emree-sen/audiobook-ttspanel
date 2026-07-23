# CLAUDE.md — Proje Rehberi

> Devralan her oturum (ve farklı cihaz) için tek kaynak. Burada kurallar, kararlar ve
> kritik kısıtlar durur; işin geçmişi `docs/superpowers/` spec/plan dosyaları ile git
> geçmişindedir.

## Proje nedir

Web novel'leri (ve kullanıcının kendi metinlerini) **duygu-duyarlı, çok-sesli**
seslendiren, üretim hattı panelli + PWA oynatıcılı, self-host bir **sesli-kitap üretim
& dinleme sistemi.** Akış: ham bölüm metni → panel içi LLM annotation → JSON
seslendirme scripti (segment + konuşan + duygu/stil + ses) → TTS + birleştirme →
dinleme. Elle JSON yapıştırma fallback (aynı şema sözleşme).

## Çalışma kuralları

- İletişim **Türkçe**. Kullanıcı: **"sor, kendin karar verme"** — tasarım/kapsam
  kararlarını tek taraflı alma; seçenekleri sun, o karar versin.
- Ucuz/pratik çözümler; astronomik API fiyatlarından kaçın; ücretsiz kotaları kullan.
- **README paritesi:** `README.md` (EN) ana, `README.tr.md` birebir çeviri. README
  içeriğine dokunan her iş İKİ dosyayı birden günceller.
- `scripts/` git-ignore'da (telifli kaynak metin içerebilir); bölüm scriptleri lokal
  kalır. Veri `./data/` (git-ignore).
- Repo public, BYO-key; lisans MIT.
- Prototip için tek anlatıcı ses yeterli (çoklu ses destekli; `--single-voice`).

## Temel kararlar

| Konu | Karar |
|---|---|
| Barındırma | **Self-host**: Next.js + SQLite (Drizzle) + yerel disk; tek-sahip auth (PANEL_PASSWORD) |
| Dil | Türkçe birincil, İngilizce ikincil |
| TTS motoru | **Gemini 3.1 Flash TTS Preview** (bake-off'ta seçildi; 2.5 robotik bulundu) |
| Adapter | Provider-agnostic (Gemini + OpenAI-uyumlu + Piper + Mock; Chirp/Azure/ElevenLabs eklenebilir) |
| İstemci | Responsive web + PWA (panel + oynatıcı tek kod) |
| Analiz akışı | raw_text → panel içi LLM annotation (provider-agnostic) → script; elle JSON da destekli |

## Durum

Plan ① (audio core + CLI) ve Dilim A→D + UI redesign tamam; panel uçtan uca çalışıyor.
Dilim E (lokal modeller) kod-tamam; kullanıcı makinesinde uçtan uca doğrulama (LM Studio +
XTTS) bekliyor. Detaylar:

- Plan ①: `docs/superpowers/plans/2026-07-13-milestone-0-audio-core.md`
- Dilim A (panel iskeleti): `docs/superpowers/specs/2026-07-16-panel-slice-a-design.md`
- Dilim B (LLM annotation): `docs/superpowers/specs/2026-07-16-panel-slice-b-llm-annotation-design.md`
- UI redesign (koyu stüdyo): `docs/superpowers/specs/2026-07-17-panel-ui-redesign-design.md`
- Dilim C1 (üretim hattı): `docs/superpowers/specs/2026-07-17-panel-slice-c1-production-line-design.md`
- Dilim C2 (sağlayıcı ekosistemi): `docs/superpowers/specs/2026-07-17-panel-slice-c2-provider-ecosystem-design.md`
- Dilim C3 (üretim akışı): `docs/superpowers/specs/2026-07-18-panel-slice-c3-production-flow-design.md`
- Dilim D (kütüphane + PWA): `docs/superpowers/specs/2026-07-19-panel-slice-d-library-pwa-player-design.md`
- Public repo cilası (README/LICENSE): `docs/superpowers/specs/2026-07-20-public-repo-readme-design.md`
- Dilim E (lokal modeller: OpenAI-uyumlu LLM + XTTS sunucusu): `docs/superpowers/specs/2026-07-23-panel-slice-e-local-models-design.md`

## Nasıl çalıştırılır

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY + PANEL_PASSWORD
npm run dev            # http://localhost:3000  (ücretsiz test: TTS_PROVIDER=mock, LLM_PROVIDER=mock)
npm test               # vitest
```

CLI: `npx tsx src/cli/generate.ts <script.json> --out ./out --provider gemini|mock`
(`--single-voice gemini:Charon`, `--model …`). Doğrulanmış Gemini sesleri: Charon,
Algieba, Algenib, Leda, Schedar, Puck, Kore, Iapetus…

## Kritik kısıtlar

1. **Gemini TTS günlük kota (RPD):** free tier'da model başına **~100 istek/gün**
   (429: `generate_requests_per_model_per_day`). Prepay/Cloud kredisi bu limiti
   YÜKSELTMEZ; gerçek billing gerekir. Panel yönetiyor: preflight + kota defteri +
   duraklat/devam; hacim için faturasız alternatif Piper / OpenAI-uyumlu lokal.
   Faturalama açılırsa `quota_limit_gemini` ayarı yükseltilir. (Chirp 3 HD adapter'ı
   ileriye dönük seçenek.)
2. **Kırılgan stil prompt'ları:** bazı stiller modeli boş yanıta/uzun sessizliğe
   itebiliyor. Adapter'da stilli→düz fallback; panelde süre bekçisi (250 ms/karakter,
   min 4 sn, 1 yeniden deneme). Sürerse segment elle düzenlenip yeniden üretilir.
3. **Türkçe doğallık:** 3.1 ampirik kabul; adapter swappable, gerekirse Chirp/Azure.

## Belgeler

- Ana tasarım/spec: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md`
  (JSON script şeması §6)
- TTS araştırması: `docs/research/2026-07-13-tts-provider-research.md`
- Bake-off kararı: `docs/research/bakeoff-notes.md`

## Backlog (kullanıcıyla önceliklendir)

VPS kurulumu + HTTPS (PWA şartı), Gemini faturalama kararı / Chirp adapter'ı,
cache & renders GC, ses önizleme düğmesi, uyku zamanlayıcısı, PNG manifest ikonları
(eski Android), stitchLatest hata metni cilası, panelden ses klonlama yönetimi
(XTTS referans wav yükleme UI'ı), ElevenLabs adapter'ı, LLM anahtarı "kayıtlı"
rozeti (ayarlar).
