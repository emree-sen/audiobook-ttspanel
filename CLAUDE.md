# CLAUDE.md — Proje Durumu ve Rehber

> Bu dosya, projeyi devralan her oturum (ve farklı cihaz) için tek kaynak. Yerel Claude hafızası cihazlar arası taşınmaz; kalıcı durum burada.

## Proje nedir

Web novel'leri (ve kullanıcının kendi metinlerini) **duygu-duyarlı, çok-sesli** seslendiren, üretim hattı panelli + PWA oynatıcılı, kendi VPS'inde barınan bir **sesli-kitap üretim & dinleme sistemi.**

**Kilit iş bölümü:** Ham bölüm metni → **panel içinde LLM annotation** (Dilim B: Gemini, provider-agnostic adapter) yapılandırılmış bir JSON "seslendirme scripti" üretir (segment + konuşan + duygu/stil + ses) → sistem TTS + birleştirme + oynatma yapar. Elle JSON yapıştırma fallback olarak durur (aynı JSON şeması sözleşme).

## Kullanıcı tercihleri (önemli)

- İletişim **Türkçe**. Kullanıcı: **"sor, kendin karar verme"** — tasarım/kapsam kararlarını tek taraflı alma; seçenekleri sun, o karar versin.
- Ucuz/pratik çözümler; astronomik API fiyatlarından kaçın; **ücretsiz Google kredisini** kullan.
- Projeler `C:/RN/` altında (bu repo: `C:/RN/webnovel-tts`).
- **Prototip için tek anlatıcı ses** yeterli (çoklu ses mimaride destekli ama şimdilik ertelendi — `--single-voice` bayrağı).

## Temel kararlar

| Konu | Karar |
|---|---|
| Barındırma | **Self-host**: Next.js + SQLite (Drizzle) + yerel disk; tek-sahip auth (PANEL_PASSWORD). Public repo, BYO-key. ~~Supabase Cloud~~ (2026-07-16'da değişti) |
| Dil | Türkçe birincil, İngilizce ikincil |
| TTS motoru | **Gemini 3.1 Flash TTS Preview** (`gemini-3.1-flash-tts-preview`) — bake-off'ta seçildi (2.5 robotik bulundu) |
| Adapter | **Provider-agnostic** (Chirp 3 HD / Azure / ElevenLabs swappable) |
| İstemci | Responsive web + **PWA** (panel + oynatıcı tek kod) |
| Analiz akışı | Panel: raw_text → **LLM annotation panel içinde otomatik** (provider-agnostic, Dilim B) → script; elle JSON yapıştırma da destekli |
| TTS sağlayıcıları | Gemini + OpenAI-uyumlu bağlantılar + Piper lokal + Mock; global tek aktif sağlayıcı; ayarlar panel içinden |

## Ne yapıldı / ne kaldı

- ✅ **Plan ① — Audio Core + Bake-off CLI**: saf TS çekirdek — zod şema, TTS adapter (Gemini + Mock), ffmpeg birleştirme, orkestratör, CLI. 23 test yeşil.
- ✅ **Dilim A — Panel iskeleti + veri katmanı + dikey dilim** (`docs/superpowers/specs/2026-07-16-panel-slice-a-design.md`, plan: `docs/superpowers/plans/2026-07-16-panel-slice-a.md`): Next.js panel, SQLite (Drizzle), tek-sahip auth, proje/bölüm CRUD, elle script import, mock/gemini ile üretim + SSE ilerleme + dinleme.
- ✅ **Dilim B — LLM annotation** (`docs/superpowers/specs/2026-07-16-panel-slice-b-llm-annotation-design.md`, plan: `docs/superpowers/plans/2026-07-16-panel-slice-b-llm-annotation.md`): provider-agnostic LLM adapter (Gemini + Mock), ses modu (tek anlatıcı / çok karakterli + maks. karakter), chunk'lama + zod-retry, ses havuzundan otomatik atama, ek talimatla yeniden üretme, cast ses düzeltme, usage/token kaydı.
- ✅ **UI Redesign — koyu stüdyo** (`docs/superpowers/specs/2026-07-17-panel-ui-redesign-design.md`): token sistemi, Manrope+JetBrains Mono (next/font), dalga-formu marka + eşitleyici animasyon, inline SVG ikonlar, ConfirmButton/EmptyState, 4 sayfa yeniden giydirildi. Davranış/API değişmedi.
- ✅ **Dilim C1 — Üretim hattı** (`docs/superpowers/specs/2026-07-17-panel-slice-c1-production-line-design.md`, plan: `docs/superpowers/plans/2026-07-17-panel-slice-c1-production-line.md`): jobs/tts_calls/audio_cache tabloları, preflight çağrı+kota hesabı, DB-destekli kuyruk (duraklat/devam, restart toparlama), content-hash cache, segment dosyaları + tek-segment yeniden üretme, progress SSE izleyici.
- ✅ **Dilim C2 — Sağlayıcı ekosistemi** (spec: docs/superpowers/specs/2026-07-17-panel-slice-c2-provider-ecosystem-design.md, plan: docs/superpowers/plans/2026-07-18-panel-slice-c2-provider-ecosystem.md): OpenAI-uyumlu adlandırılmış bağlantılar + Piper lokal adapter (kullanıcı kurulumlu), /settings ekranı (anahtarlar DB+env, maskeli), DB-tabanlı sağlayıcı-bazlı ses havuzu, yetenek bildirimi (stilsiz sağlayıcıda stil düşürme + not).
- ✅ **Dilim C3 — Üretim akışı iyileştirmeleri** (spec: `docs/superpowers/specs/2026-07-18-panel-slice-c3-production-flow-design.md`, plan: `docs/superpowers/plans/2026-07-18-panel-slice-c3-production-flow.md`): narrator modunda az-segment (prompt + mergeSegments), script JSON + segment satır düzenleme, ayrı "Birleştir" adımı (`voiced` durumu, regen otomatik stitch yapmaz), **KN1** TTS süre bekçisi (model tekrar arızası), **KN2** worker tekilliği (globalThis + atomik iş sahiplenme — dev'de kota 2x yanma bug'ı).
- ⬜ **Dilim D — Kütüphane + PWA oynatıcı**: liste·oynat·resume·MediaSession·offline. SONRAKİ.

## Nasıl çalıştırılır

### Panel

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY + PANEL_PASSWORD
npm run dev            # http://localhost:3000  (test: TTS_PROVIDER=mock)
npm test               # vitest (çekirdek + panel testleri)
```

Veri: `./data/` (SQLite `app.db` + `audio/`); git-ignore'da.

### CLI

```bash
# .env oluştur:  GEMINI_API_KEY=<anahtar>
# Bir JSON scriptten mp3 üret:
npx tsx src/cli/generate.ts <script.json> --out ./out --provider gemini
# Tek anlatıcı sesle (prototip):
npx tsx src/cli/generate.ts <script.json> --out ./out --provider gemini --single-voice gemini:Charon
# Ücretsiz/maliyetsiz test:
npx tsx src/cli/generate.ts <script.json> --out ./out --provider mock
# Model değiştir: --model gemini-2.5-flash-preview-tts
```

- JSON seslendirme scripti şeması: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md` §6.
- Gemini prebuilt sesler (doğrulanmış çalışan): Charon, Algieba, Algenib, Leda, Schedar, Puck, Kore, Iapetus...
- **`scripts/` git-ignore** (telifli kaynak metin içerebilir). Bölüm scriptleri lokal kalır.

## Bilinen kısıtlar / bulgular (KRİTİK)

1. **GÜNLÜK KOTA (RPD) — EN KRİTİK BLOKER:** `gemini-3.1-flash-tts` modelinde **günde 100 istek** hard limit (429 metric: `generate_requests_per_model_per_day`, limit 100, per project per model). Bu **free-tier** limiti — kullanıcının 'prepay' key'i + Google free-trial kredisi bu per-model günlük kotayı **YÜKSELTMİYOR** (free-trial Cloud kredisidir, AI Studio Gemini API tier'ını değiştirmez). Sonuç: şu an günde **~1 bölüm** (87 segment) ancak; hacim (Faz 2) imkansız. Bir bölüm bile bugünkü test çağrılarıyla birleşince yarıda kaldı (40/87). **Çözümler:** (a) **Gemini API projesinde gerçek faturalama/billing aç** → paid tier RPD binlerce olur (asıl çözüm); (b) hacim için **Cloud TTS Chirp 3 HD** (karakter-bazlı, ayrı & yüksek kota, Cloud kredisi geçerli) veya Vertex — ayrı adapter gerektirir; (c) günlük reset sonrası (00:00 PT) temiz bir çalıştırma <100 segment bölümü tek seferde yapar. Ek olarak RPM için adapter'da throttle (6s) + stilli→düz fallback + segment-atla dayanıklılığı var. GÜNCELLEME (C1): panel artık preflight + kota defteri + duraklat/devam ile bu limiti yönetiyor; faturalama/Chirp kararı C2 ile birlikte. GÜNCELLEME (C2): hacim için artık faturasız alternatifler panelde: Piper (lokal, bedava) veya OpenAI-uyumlu lokal sunucular; Chirp adapter'ı istenirse ileride ayrı iş. GÜNCELLEME (C3): dev'de çift-worker kota 2x yakma bug'ı kapatıldı (atomik iş sahiplenme).
2. **Kırılgan stil prompt'ları:** Bazı stil talimatları modeli sessizce boş yanıta itiyor (preview, non-deterministik). Adapter'da **stilli → düz metin fallback** var (o segment stilsiz de olsa ses üretilir). GÜNCELLEME (C3): model bazen stilli kısa segmentlerde metni tekrarlayıp uzun sessizlik üretiyor; panel süre bekçisi (250 ms/karakter, min 4 sn) absürt çıktıda 1 kez yeniden deneyip kısa sonucu kullanıyor. Sorun sürerse segment "düzenle/yeniden üret" ile elle çözülür.
3. **Türkçe doğallık:** ampirik doğrulandı (3.1 kabul); adapter swappable olduğundan gerekirse Chirp/Azure denenebilir.

## Belgeler

- Tasarım/spec: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md`
- TTS araştırması (kaynaklı): `docs/research/2026-07-13-tts-provider-research.md`
- Bake-off notları/karar: `docs/research/bakeoff-notes.md`
- Plan ①: `docs/superpowers/plans/2026-07-13-milestone-0-audio-core.md`

## Sonraki oturum için öneri

Dilim D (kütüphane + PWA oynatıcı) için brainstorming: proje/bölüm listesi, oynat/duraklat/kaldığı yerden devam, MediaSession entegrasyonu, offline (service worker + önbellek), PWA manifest/kurulum. C3'ten miras: `voiced` durumu (segmentler üretildi ama son mp3 henüz "Birleştir" edilmedi/güncel değil) D oynatıcısında dikkate alınmalı — kütüphane/oynatıcı yalnız gerçekten dinlenebilir (birleştirilmiş, güncel) bölümleri oynatılabilir göstermeli, `voiced` bölümler için "önce panelde Birleştir" yönlendirmesi gerekebilir. Ertelenmişler: ses önizleme düğmesi, varsayılan anlatıcı sesi UI'sı, yalnız-mp3 OpenAI-uyumlu sunucular, cache GC, sidebar hata durumu, PWA statik varlık auth (D), dokunmatik tile aksiyonları (D).
