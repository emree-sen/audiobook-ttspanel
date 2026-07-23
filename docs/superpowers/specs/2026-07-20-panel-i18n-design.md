# Panel i18n (EN+TR) + marka + iki set README görseli — Tasarım

Tarih: 2026-07-20
Durum: Onaylandı (kullanıcı, sohbet içinde)

## Amaç

Panel arayüzü ve API mesajları İngilizce + Türkçe konuşsun; uygulama içi marka
`audiobook-ttspanel` olsun; README görselleri iki set (EN/TR) olarak yeniden çekilsin —
README.md EN görselleri, README.tr.md TR görselleri kullansın.

## Kararlar (kullanıcı onaylı)

| Konu | Karar |
|---|---|
| Yöntem | Gerçek i18n (DOM hilesi ve next-intl reddedildi); el yapımı hafif altyapı |
| Kapsam | Arayüz + API hata/durum mesajları (tüm görünür metin) |
| Varsayılan dil | Cookie yoksa `Accept-Language`: Türkçe ise TR, değilse EN |
| Seçici yeri | Ayarlar sayfası + sidebar altında TR/EN kısayolu |
| Marka | Sidebar başlığı, metadata title, PWA manifest `name`/`short_name` → `audiobook-ttspanel` |
| Görseller | İki set: `docs/screenshots/en/` + `docs/screenshots/tr/`; eski düz PNG'ler silinir |

## Mimari

### Sözlük (lib/i18n/)

- `lib/i18n/tr.ts`: düz anahtarlı sözlük (`export const tr = { "chapter.generate": "Üret", ... } as const`).
- `lib/i18n/en.ts`: `export const en: Record<MessageKey, string> = {...}` — `MessageKey = keyof typeof tr`; eksik/fazla anahtar **derleme hatası**.
- Anahtar adlandırma: `alan.eylem` (ör. `settings.title`, `player.speed`, `error.quotaExceeded`). Dinamik değerler `{name}` yer tutucusuyla, basit `format(msg, params)` yardımcıyla.
- `lib/i18n/index.ts`: `type Lang = "tr" | "en"`, `getDict(lang)`, `format()`, `resolveLang(cookieValue, acceptLanguage)` saf fonksiyonu.

### Dil çözümü ve saklama

- Tercih `lang` cookie'sinde (`tr` | `en`, path=/, max-age 1 yıl, SameSite=Lax).
- `resolveLang`: geçerli cookie → onu kullan; yoksa `Accept-Language` içinde `tr` en yüksek öncelikli dilse TR, değilse EN.
- Sunucu (layout, API rotaları) cookie'yi `next/headers` / `req.cookies` ile okur; istemci dil değiştirirken `document.cookie` yazar.

### İstemci

- `lib/ui/LanguageProvider.tsx`: `"use client"` context; `app/layout.tsx` (server) `resolveLang` ile başlangıç dilini çözüp provider'a prop geçer. `useT()` hook'u `t(key, params?)` döner; `useLang()` mevcut dil + `setLang(lang)` (cookie yaz + state güncelle — sayfa yenilemesiz).
- Metin içeren tüm client dosyalar anahtara taşınır: app/page, login, projects/[id], chapters/[id], library, settings sayfaları ile lib/ui/Sidebar, LogoutButton, player/PlayerBar, player/PlayerProvider (+ sabit metni varsa ConfirmButton varsayılanları). `EmptyState`/`ConfirmButton` gibi metni prop alan bileşenlerin kendisi değişmez; çağıran taraf `t()` sonucunu geçer. Metin içermeyen dosyalara (Icon, RegisterSw vb.) dokunulmaz.

### API mesajları

- `lib/i18n/server.ts`: `tServer(req, key, params?)` — istekten dili çözer, sözlükten döner. (`NextRequest.cookies` + `accept-language` başlığı.)
- Türkçe metin içeren tüm rotalar (`app/api/**`) ve gerekiyorsa `lib/services/*` içindeki kullanıcıya akan mesajlar (SSE progress metinleri dahil) `tServer`'a taşınır. Loglar/iç hata metinleri kapsam dışı.
- İstemciden bağımsız üretilen mesajlar (worker'ın DB'ye yazdığı, sonradan gösterilen metinler — ör. job hata metni) için kural: **anahtar değil, üretim anındaki dille metin** yazılır (basitlik; tek kullanıcılı panel). Bu bilinen ve kabul edilen bir kısıttır.

### Seçici + marka

- Ayarlar sayfası: "Dil / Language" seçimi (TR/EN radio veya select).
- Sidebar altı: mevcut dile göre `TR | EN` mini kısayol.
- Marka: `lib/ui/Sidebar.tsx` başlığı, `app/layout.tsx` metadata title'ları, `public/manifest.webmanifest` `name`/`short_name` → `audiobook-ttspanel`. (Manifest tek dilli kalır; PWA adı dile göre değişmez.)

## Görseller (i18n sonrası)

- Mock sağlayıcı + geçici DATA_DIR ile iki çekim turu (Task 2'deki üretim hattının aynısı):
  - `docs/screenshots/tr/{studio,library}.png` — TR arayüz, Türkçe örnek kurgu (Kayıp Fener tarzı, yeniden seed).
  - `docs/screenshots/en/{studio,library}.png` — EN arayüz (cookie `lang=en`), bu iş için yazılacak özgün İngilizce örnek kurgu.
- README.md `docs/screenshots/en/…`, README.tr.md `docs/screenshots/tr/…` kullanır; eski `docs/screenshots/{studio,library}.png` silinir. İki README birden güncellenir (parite kuralı).

## Test

- Sözlük parite testi (TR/EN anahtar kümeleri eşit — tip zaten koruyor, test regresyon belgesi).
- `resolveLang` birim testleri (cookie öncelikli, Accept-Language `tr` varyantları, boş/deforme girdi → EN).
- `format()` yer tutucu testi.
- Türkçe metin bekleyen mevcut API/panel testleri güncellenir (test istekleri `lang=tr` cookie'siyle ya da beklenti anahtar diline göre); tüm süit yeşil.

## Kapsam dışı

- URL tabanlı locale (`/en/...`) yok; SEO hedefi yok (panel auth arkasında).
- Üçüncü dil altyapısı hazır (sözlük ekle) ama iş kapsamında değil.
- LLM annotation çıktı dili / TTS içerik dili bu işten bağımsız (içerik dili kullanıcı metnine bağlı).
