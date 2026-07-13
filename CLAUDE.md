# CLAUDE.md — Proje Durumu ve Rehber

> Bu dosya, projeyi devralan her oturum (ve farklı cihaz) için tek kaynak. Yerel Claude hafızası cihazlar arası taşınmaz; kalıcı durum burada.

## Proje nedir

Web novel'leri (ve kullanıcının kendi metinlerini) **duygu-duyarlı, çok-sesli** seslendiren, üretim hattı panelli + PWA oynatıcılı, kendi VPS'inde barınan bir **sesli-kitap üretim & dinleme sistemi.**

**Kilit iş bölümü:** Ham bölüm metni → **Claude (oturum içinde, elle) yapılandırılmış bir JSON "seslendirme scripti" üretir** (segment + konuşan + duygu/stil + ses) → sistem TTS + birleştirme + oynatma yapar. Otomatik hatta LLM yok; ileride annotator otomatikleşecek (aynı JSON şeması sözleşme).

## Kullanıcı tercihleri (önemli)

- İletişim **Türkçe**. Kullanıcı: **"sor, kendin karar verme"** — tasarım/kapsam kararlarını tek taraflı alma; seçenekleri sun, o karar versin.
- Ucuz/pratik çözümler; astronomik API fiyatlarından kaçın; **ücretsiz Google kredisini** kullan.
- Projeler `C:/RN/` altında (bu repo: `C:/RN/webnovel-tts`).
- **Prototip için tek anlatıcı ses** yeterli (çoklu ses mimaride destekli ama şimdilik ertelendi — `--single-voice` bayrağı).

## Temel kararlar

| Konu | Karar |
|---|---|
| Barındırma | **Supabase Cloud** (Postgres·Auth·Storage) + Next.js app & Node/TS worker kullanıcının **VPS**'inde |
| Dil | Türkçe birincil, İngilizce ikincil |
| TTS motoru | **Gemini 3.1 Flash TTS Preview** (`gemini-3.1-flash-tts-preview`) — bake-off'ta seçildi (2.5 robotik bulundu) |
| Adapter | **Provider-agnostic** (Chirp 3 HD / Azure / ElevenLabs swappable) |
| İstemci | Responsive web + **PWA** (panel + oynatıcı tek kod) |
| Analiz akışı | Panel: raw_text → Claude JSON script → import (Faz 1 elle; Faz 2 otomatik) |

## Ne yapıldı / ne kaldı (Faz 1, 5 plana bölündü)

- ✅ **Plan ① — Audio Core + Bake-off CLI** (`docs/superpowers/plans/2026-07-13-milestone-0-audio-core.md`): saf TS çekirdek — zod şema, TTS adapter (Gemini + Mock), ffmpeg birleştirme, orkestratör, CLI. **23 test yeşil.** Bake-off ile motor ampirik seçildi.
- ⬜ **Plan ② — Supabase Backend** (şema, RLS, Storage, veri katmanı) — SONRAKİ. Kullanıcının Supabase projesi/kimlik bilgileri gerekir.
- ⬜ **Plan ③ — Worker Pipeline** (Postgres job kuyruğu, üretim, content-hash cache, maliyet, retry).
- ⬜ **Plan ④ — Panel** (auth, CRUD, script import, ses registry, üretim hattı monitörü).
- ⬜ **Plan ⑤ — Oynatıcı (PWA)** (kütüphane, playback, resume, MediaSession, offline).

## Nasıl çalıştırılır (Plan ①)

```bash
npm install
npm test                       # vitest, 23 test

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

1. **RPM rate limit (3.1 preview tier):** Hızlı ardışık çağrılar dakikalık limite takılıyor; Google bunu bazen sessiz **boş yanıt**, bazen **429** olarak döndürüyor. Adapter'a **throttle (çağrı arası 6s)** eklendi. **Hacim (Faz 2) için darboğaz** → kullanıcı API tier/kotasını netleştirmeli (429 "check your plan and billing" → key hâlâ free-tier limitlerinde olabilir) veya hacim için **Cloud TTS/Vertex** (kredi + yüksek kota).
2. **Kırılgan stil prompt'ları:** Bazı stil talimatları modeli sessizce boş yanıta itiyor (preview, non-deterministik). Adapter'da **stilli → düz metin fallback** var (o segment stilsiz de olsa ses üretilir).
3. **Türkçe doğallık:** ampirik doğrulandı (3.1 kabul); adapter swappable olduğundan gerekirse Chirp/Azure denenebilir.

## Belgeler

- Tasarım/spec: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md`
- TTS araştırması (kaynaklı): `docs/research/2026-07-13-tts-provider-research.md`
- Bake-off notları/karar: `docs/research/bakeoff-notes.md`
- Plan ①: `docs/superpowers/plans/2026-07-13-milestone-0-audio-core.md`

## Sonraki oturum için öneri

Plan ②'yi yazmaya (writing-plans) geçmeden önce kullanıcının Supabase projesi + kimlik bilgilerini iste. Ayrıca Faz 2 hacim planı için RPM/kota konusunu netleştir.
