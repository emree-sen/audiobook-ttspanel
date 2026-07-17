# Panel UI Redesign — "Koyu Stüdyo"

> Tarih: 2026-07-17 · Durum: onaylandı (brainstorming) · Sonraki adım: writing-plans
> İlgili: Dilim A/B spec'leri (davranış sözleşmeleri DEĞİŞMEZ); Dilim C bu görsel sistemi miras alacak.

## 1. Amaç ve kapsam

Panelin 4 sayfasını (login, projeler, bölümler, çalışma alanı) **modern, şık, koyu "stüdyo" kimliğine** taşımak. Salt görsel katman + küçük etkileşim iyileştirmeleri; **API sözleşmeleri, servisler ve davranış değişmez** (tek istisna: `confirm()` yerine inline onay deseni).

**Kararlar (2026-07-17):** koyu stüdyo atmosferi · saf CSS + design token (Tailwind yok) · üst bar + breadcrumb (sidebar yok) · cila paketi: next/font tipografi + inline SVG ikon seti + confirm() ikamesi + boş durum/mikro animasyon. Uygulama task'larında implementer'lar **frontend-design skill'ini yükleyerek** çalışır.

## 2. Görsel dil

### 2.1 Renk (token'lar `app/globals.css` `:root`)
- Zemin katmanları: `--bg #0f1115` (taban), `--surface #16181f` (kart), `--surface-2 #1d2029` (yükseltilmiş/iç alan), `--border #262a35`.
- Metin: `--text #e9eaf0`, `--text-muted #9aa0ae`.
- Vurgu: `--accent #f59e0b` (amber), `--accent-hover #fbbf24`, `--accent-fg #1a1205` (amber üstü metin).
- Durum: `--ok #34d399` (done), `--err #f87171` (error/failed), `--info #60a5fa` (scripted), generating = amber + pulse animasyonu; `draft` nötr gri.
- Yüzeyler katman kontrastı + yumuşak gölge (`--shadow: 0 4px 24px rgb(0 0 0 / .35)`); 1px kenar yalnız gerekli yerde.

### 2.2 Tipografi (next/font, self-host — harici istek yok)
- **Manrope** (değişken ağırlık): başlık + gövde. `--font-sans`.
- **JetBrains Mono**: JSON textarea, segment metni, token/istatistik sayıları. `--font-mono`.
- Ölçek: gövde 15px/1.6; h1 22px/700; h2 15px/600 büyük-harf-aralıklı kart başlığı.

### 2.3 Biçim token'ları
- `--radius: 12px` (kart), `--radius-sm: 8px` (buton/girdi); spacing ölçeği 4/8/12/16/24/32; geçişler 150-200ms ease-out.

## 3. App shell (`app/layout.tsx`)
- Üst bar: **sol** marka — küçük dalga-formu SVG logosu + "webnovel-tts" (ana sayfa linki); **orta-sol** breadcrumb (Projeler › {proje} › {bölüm}); **sağ** çıkış düğmesi.
- Breadcrumb: sayfalar mevcut GET yanıtlarındaki adlarla kendi kırıntılarını basar (yeni API yok). Layout server component kalır; breadcrumb sayfa içinde render edilir (`.crumbs` sınıfı) — layout'a global state taşınmaz.
- Çıkış: `POST /api/auth/logout` çağıran küçük client bileşeni; auth kapalıyken (PANEL_PASSWORD boş) gizlenmesi ŞART DEĞİL (her zaman görünebilir; logout auth'suz da zararsız).
- Mobil (<640px): breadcrumb son 2 seviyeye kısalır, bar tek satır kalır.

## 4. Bileşen sistemi (kütüphanesiz)

### 4.1 `lib/ui/` client bileşenleri
- `Icon.tsx` — inline SVG sprite; ikonlar: play, pause, sil (çöp), düzenle (kalem), ses (hoparlör), karakter (kişi), belge (script), dalga, artı, uyarı, yukarı/aşağı ok, çıkış, yükleniyor (spinner). `size` + `aria-label` prop'ları; `currentColor`.
- `ConfirmButton.tsx` — ilk tık: danger görünümüne geçer, "Emin misin?" metni, 3 sn sonra eski hâline döner; ikinci tık: `onConfirm` çağrılır. Tüm `confirm()` kullanımlarının yerine geçer (projeler + bölümler silme).
- `EmptyState.tsx` — ikon + başlık + açıklama + isteğe bağlı eylem alanı; boş proje/bölüm/segment listelerinde.

### 4.2 CSS sınıfları (globals.css)
- `.btn` (primary amber), `.btn.ghost`, `.btn.danger`; ikonlu buton desteği; `:focus-visible` amber ring; `disabled` durumları.
- `.card` — başlık şeridi (`.card > h2` ikonlu) + gövde; hover'da hafif yükselme (yalnız tıklanabilir kartlarda).
- `.badge` — durum eşleme: draft nötr, scripted info, generating amber+pulse, done ok, error/failed err.
- `.table` — mono hücre seçeneği, satır hover, sıkı ama okunur yoğunluk.
- Form elemanları — koyu iç yüzey, focus ring, placeholder muted.
- `.progress` — amber dolgu; üretim/annotation sırasında **eşitleyici-çubuk (equalizer) animasyonu** eşlik eder.
- `.crumbs`, `.topbar`, `.brand`, `.empty`, `.player` (audio sarmalayıcı).
- `@media (prefers-reduced-motion: reduce)` → tüm animasyonlar kapanır.
- Erişilebilirlik: metin/zemin çiftleri WCAG AA; ikon-yalnız butonlarda `aria-label`.

## 5. Sayfalar (davranış birebir korunur)
- **Login:** ortalanmış marka paneli — logo + başlık + şifre alanı + tek buton; zeminde çok silik dalga deseni (CSS gradient/SVG, resim dosyası yok).
- **Projeler (`/`):** kart **grid'i** (min 240px, auto-fill); kart: proje adı + "N bölüm" + göreli güncelleme zamanı + sil (ConfirmButton, hover'da görünür). Üstte başlık + "Yeni proje" satır formu. Boş durum EmptyState. Not: bölüm sayısı/updatedAt `GET /api/projects` yanıtında yoksa yalnız mevcut alanlar gösterilir — **API'ye alan eklemek kapsam dışı**; kartta ad + tarih (projects.updatedAt zaten dönüyor) yeterli.
- **Bölümler (`/projects/[id]`):** breadcrumb; satır listesi — sol: pozisyon rozeti + ad; sağ: durum rozeti + yukarı/aşağı sıralama ikonları + yeniden adlandır (mevcut prompt-tabanlı akış korunur; görsel ikonlaşır) + sil (ConfirmButton). Boş durum.
- **Çalışma alanı (`/chapters/[id]`):** breadcrumb "Projeler › Bölümler › {bölüm adı}" — "Bölümler" bağlantısı `chapter.projectId` ile kurulur; proje ADI için ekstra fetch YAPILMAZ (mevcut GET yanıtı yeterli). Kartlar: Ham metin (mod seçici segmented-control görünümü) → Script (cast tablosu, talimat satırı, details içinde mono JSON alanı) → Üretim (büyük Üret butonu, eşitleyici animasyonlu ilerleme, oynatıcı satırları) → Segmentler (mono tablo, uzun metin satır-içi kırpma). Üretim/annotation busy durumlarında ilgili kart başlığında spinner.

## 6. Dosya değişimleri
- Değişir: `app/globals.css` (yeniden yazılır), `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/projects/[id]/page.tsx`, `app/chapters/[id]/page.tsx`.
- Yeni: `lib/ui/Icon.tsx`, `lib/ui/ConfirmButton.tsx`, `lib/ui/EmptyState.tsx`.
- `package.json` DEĞİŞMEZ (next/font Next'in içinde; Google font'ları `next/font/google` ile build'te self-host edilir — çalışma anında harici istek yok).
- API rotaları, servisler, `src/core`, testlerin davranış beklentileri: DOKUNULMAZ.

## 7. Doğrulama
- `npm run build && npm test` — mevcut 99 test yeşil (UI-only; API testleri etkilenmez).
- `ConfirmButton` için React test altyapısı EKLENMEZ (yeni bağımlılık istemez — kapsam dışı); davranışı headless/manuel smoke'ta doğrulanır. Repo'da UI birim test altyapısı Dilim D ile birlikte değerlendirilir.
- Headless smoke: mock LLM+TTS ile ana akış HTTP üzerinden (Dilim B smoke'unun kısaltılmışı) — sayfalar 200 + ana içerik işaretleri.
- **Kullanıcı görsel onayı:** dev server'da 4 sayfa ekran ekran gezilir; nihai kabul kullanıcıda.

## 8. Kapsam dışı
- Açık tema / tema anahtarı; Tailwind veya bileşen kütüphanesi; yeni özellik/endpoint; PWA (Dilim D); Dilim C üretim-hattı ekranları (bu sistemi miras alacak).
