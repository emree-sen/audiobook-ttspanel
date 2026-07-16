# webnovel-tts

Web novel'leri (ve kendi metinlerini) duygu-duyarlı, çok-sesli seslendiren **self-host** sesli-kitap üretim & dinleme paneli. Kendi API anahtarını getirirsin (BYO-key), maliyeti kendin ödersin, verin kendi diskinde kalır.

## Durum

- ✅ Ses çekirdeği: JSON seslendirme script'i → Gemini TTS → mp3 (CLI)
- ✅ Web panel (Dilim A): proje/bölüm yönetimi, script import, üretim + dinleme
- ⬜ LLM annotation (metin → script otomatik), sağlam üretim kuyruğu, PWA oynatıcı

## Kurulum

Gereksinimler: Node ≥ 20.

```bash
git clone <repo>
cd webnovel-tts
npm install
cp .env.example .env   # GEMINI_API_KEY ve PANEL_PASSWORD doldur
npm run dev            # http://localhost:3000
```

> **Uyarı:** `PANEL_PASSWORD` boşsa panel şifresiz açılır — yalnızca lokal geliştirme için. İnternete açacaksan mutlaka doldur.

Üretim (production) için: `npm run build && npm start`.

## Kullanım

1. Panelde proje → bölüm oluştur, ham metnini yapıştır.
2. Şimdilik: bölüm metnini Claude'a verip JSON seslendirme script'i üret (şema: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md` §6), panele yapıştır. (LLM annotation panele entegre edilecek — Dilim B.)
3. "Üret" → segment segment TTS + birleştirme → tarayıcıda dinle.

Ücretsiz deneme için `.env`'de `TTS_PROVIDER=mock` (sessiz test sesi üretir, API çağrısı yapmaz).

CLI hâlâ çalışır: `npx tsx src/cli/generate.ts <script.json> --out ./out --provider gemini`

## Bilinen kısıtlar

- Gemini TTS free tier: **günde 100 istek** (model başına). Uzun bölümler yarıda kalabilir; başarısız segmentler işaretlenir. Faturalamalı (paid tier) anahtarla limit yükselir.
- Ses `<audio>` ile tam-dosya servis edilir; ileri sarma kısıtlı olabilir (iyileştirme planlı).

## Veri

Her şey `./data/` altında: `app.db` (SQLite) + `audio/` (mp3'ler). Yedeklemek = bu klasörü kopyalamak.
