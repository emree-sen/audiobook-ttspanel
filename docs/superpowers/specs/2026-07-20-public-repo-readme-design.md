# Public repo cilası: README + LICENSE + CLAUDE.md temizliği — Tasarım

Tarih: 2026-07-20
Durum: Onay bekliyor

## Amaç

Repo artık public. Dört çıktı:

1. **README.md (İngilizce, ana)** — popüler repolar tarzında vitrin + tam döküman.
2. **README.tr.md (Türkçe)** — aynı yapının birebir çevirisi; iki dosyada da üstte dil geçiş linki.
3. **LICENSE** — MIT (Copyright 2026 Emre ŞEN).
4. **CLAUDE.md temizliği** — kural/tercih/kısıt odaklı; dilim geçmişi tek satır durum + spec linklerine iner.

## Kararlar (kullanıcı onaylı)

| Konu | Karar |
|---|---|
| Dil | İngilizce ana (README.md) + Türkçe ek (README.tr.md) |
| Görsel | Panelden ekran görüntüleri (mock sağlayıcı ile çekilecek), `docs/screenshots/` |
| Kapsam | Tek dosyada vitrin + tam pratik döküman |
| Proje adı | `audiobook-ttspanel` (repo adıyla aynı; "webnovel-tts" başlığı bırakılır) |
| Lisans | MIT |
| CLAUDE.md geçmişi | Kısa durum satırı + spec/plan linkleri; anlatımlar silinir |

## README.md yapısı

1. **Hero** (ortalanmış): başlık `audiobook-ttspanel`, slogan ("Emotion-aware, multi-voice audiobook studio for web novels — self-hosted, bring your own key" ayarında), rozetler (statik shields: License MIT, Node ≥ 20, Next.js, TypeScript, tests: vitest, PRs welcome — CI olmadığından sahte build rozeti YOK), dil linkleri `English | Türkçe`.
2. **Ekran görüntüleri**: 2-3 kare — üretim/stüdyo ekranı, kütüphane + oynatıcı. Mock sağlayıcı + örnek içerikle dev sunucudan çekilir; `docs/screenshots/*.png`.
3. **How it works**: kısa tanıtım + mermaid boru hattı diyagramı (raw text → LLM annotation → script JSON → TTS provider → stitch → PWA player). GitHub mermaid'i native render eder.
4. **Features**: gruplu liste (Studio / Production pipeline / Providers / Listening & PWA). "Dilim A/B/C" jargonu kullanılmaz; kullanıcı gözünden yazılır.
5. **Quick start**: gereksinimler, clone/env/dev; mock ile ücretsiz deneme notu.
6. **TTS providers**: karşılaştırma tablosu (Gemini / OpenAI-compatible / Piper / Mock — stil desteği, maliyet, kota) + mevcut kurulum talimatlarının çevirisi.
7. **Usage**: 3 adımlı akış (bugünkü içerik).
8. **Listening (PWA)**: kurulum, kütüphane/devam, offline, kontroller, iOS kısıtı.
9. **Known limitations**: Gemini kota, LLM modeli, seek kısıtı.
10. **Data & self-hosting**: `./data/` yedekleme; HTTPS/PWA notu.
11. Altbilgi: teknik yığın tek satır + License bölümü.

README.tr.md aynı sıra ve içerikte Türkçe. Parite kuralı: README içeriği değişen her iş iki dosyayı birden günceller (CLAUDE.md'ye kural olarak yazılır).

## Ekran görüntüsü planı

- `TTS_PROVIDER=mock`, `LLM_PROVIDER=mock` ile dev sunucu; örnek proje/bölüm içeriği oluşturulur (telifsiz kısa örnek metin).
- Playwright (npx) ile ~1280px genişlik, koyu stüdyo teması; 2-3 PNG.
- Çekilemezse (ortam engeli) README görsel yer tutucusuz yayınlanır, görseller ayrı işe kalır — README bloklanmaz.

## CLAUDE.md yeni yapısı

1. Proje nedir (2-3 cümle, değişmez).
2. Çalışma kuralları / kullanıcı tercihleri (Türkçe iletişim, "sor, kendin karar verme", ucuz çözümler, README EN+TR parite kuralı).
3. Temel kararlar tablosu (mevcut, korunur).
4. Durum: tek satır ("Plan ① + Dilim A→D tamam") + spec/plan dosya linkleri listesi.
5. Nasıl çalıştırılır (mevcut, kısaltılmış).
6. Kritik kısıtlar (Gemini RPD kota özeti — güncel çözümleriyle kısaltılmış; stil fallback; Türkçe doğallık tek satır).
7. Belgeler + backlog (mevcut "sonraki oturum" listesi).

Bilgi kaybı olmaması için silinen anlatımların zaten spec/plan dosyalarında ve git geçmişinde bulunduğu doğrulanır; oralarda olmayan kritik bilgi (ör. kota bulgularının özü) CLAUDE.md'de tutulur.

## Doğrulama

- README.md ve README.tr.md GitHub'da düzgün render (mermaid dahil) — push sonrası kontrol.
- Tüm iç linkler (docs/, screenshots) geçerli.
- `npm test` etkilenmez (yalnız doküman + LICENSE değişiyor; kod değişikliği yok).
