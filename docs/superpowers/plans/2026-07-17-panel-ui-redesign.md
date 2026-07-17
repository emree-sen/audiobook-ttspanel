# Panel UI Redesign ("Koyu Stüdyo") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Her implementer, işe başlamadan önce `frontend-design:frontend-design` skill'ini yüklemeli** (görsel işçilik kalite çıtası için).

**Goal:** 4 panel sayfasını (login, projeler, bölümler, çalışma alanı) koyu stüdyo kimliğine taşımak: token sistemi, Manrope+JetBrains Mono, dalga-formu imza motifi, inline SVG ikonlar, ConfirmButton, EmptyState, mikro animasyon. Davranış/API değişmez.

**Architecture:** Saf CSS design-token sistemi (`globals.css` yeniden yazılır) + `lib/ui/` küçük client bileşenleri (Icon/ConfirmButton/EmptyState/LogoutButton) + sayfa sayfa geçiş. `next/font/google` ile self-host font (build sırasında bir kez internet ister, çalışma anında harici istek yok).

**Tech Stack:** Mevcut yığın; **yeni npm bağımlılığı YOK** (`package.json` değişmez).

**Spec:** `docs/superpowers/specs/2026-07-17-panel-ui-redesign-design.md`

## Global Constraints

- **Davranış/API değişmez:** fetch çağrıları, endpoint'ler, state akışı birebir korunur. Tek istisna: `confirm()` çağrıları `ConfirmButton`'a taşınır (prompt() tabanlı yeniden adlandırma AYNEN kalır).
- `src/core/**`, `lib/services/**`, `lib/db/**`, `app/api/**` DOKUNULMAZ.
- Mevcut **99 test + `npm run build` her task sonunda yeşil**.
- Türkçe UI metinleri; kod stili kompakt, Türkçe yorumlar.
- Erişilebilirlik tabanı: ikon-yalnız butonlarda `aria-label` + `title`; `:focus-visible` halkası; `prefers-reduced-motion` desteği.
- Font subset'lerinde **`latin-ext` ZORUNLU** (Türkçe ğ/ş/ı/İ/ö/ü/ç).
- Renk/biçim değerleri AŞAĞIDAKİ token bloğundan; yeni renk uydurulmaz.

---

### Task 1: Token sistemi + tipografi + app shell

**Files:**
- Modify: `app/globals.css` (TAM yeniden yazım — aşağıdaki içerik)
- Modify: `app/layout.tsx`
- Create: `lib/ui/LogoutButton.tsx`
- Create: `lib/ui/Icon.tsx` (LogoutButton'ın ihtiyacı olduğu için bu task'ta; tam ikon seti dahil)

**Interfaces:**
- Consumes: mevcut sayfaların kullandığı sınıflar (`.card .row .muted .err .badge` vs.) — İSİMLERİ KORUNUR ki Task 3-6 gelmeden sayfalar bozuk görünmesin (eski markup yeni stille de çalışır).
- Produces: token'lar, `.topbar/.brand/.crumbs/.spacer`, `.btn` davranışlı `button` temel stili (`.ghost/.danger/.icon`), `.seg`, `.grid/.tile`, `.rows/.rowitem`, `.empty`, `.eq`, `.player`, `.login-wrap/.login`, `.spin`; `Icon` bileşeni (`IconName` tipi); `LogoutButton`.

- [ ] **Step 1: globals.css'i tamamen değiştir**

`app/globals.css` tam içerik:

```css
/* ── Design token'ları — koyu stüdyo ─────────────────────────────── */
:root {
  --bg: #0f1115;
  --surface: #16181f;
  --surface-2: #1d2029;
  --border: #262a35;
  --text: #e9eaf0;
  --muted: #9aa0ae;
  --accent: #f59e0b;
  --accent-hover: #fbbf24;
  --accent-fg: #1a1205;
  --ok: #34d399;
  --err: #f87171;
  --info: #60a5fa;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgb(0 0 0 / 0.35);
  --font-sans: var(--font-manrope), system-ui, sans-serif;
  --font-mono: var(--font-jbmono), ui-monospace, monospace;
}

* { box-sizing: border-box; }
html { color-scheme: dark; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 15px; line-height: 1.6;
  background: var(--bg); color: var(--text);
}
a { color: inherit; text-decoration: none; }
a:hover { color: var(--accent-hover); }
h1 { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.02em; margin: 0.4rem 0 1rem; }
h1 .badge { vertical-align: middle; margin-left: 0.5rem; }

/* ── Üst bar + kırıntı ── */
.topbar {
  display: flex; align-items: center; gap: 1rem;
  padding: 0.65rem 1.2rem;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(8px);
}
.brand { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 800; letter-spacing: -0.01em; }
.brand svg { color: var(--accent); }
.spacer { flex: 1; }
.crumbs { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.9rem; min-width: 0; }
.crumbs a:hover { color: var(--text); }
.crumbs .sep { opacity: 0.4; }
.crumbs .here { color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.container { max-width: 62rem; margin: 0 auto; padding: 1.4rem 1.2rem 3rem; animation: fadein 200ms ease-out; }

/* ── Butonlar ── */
button {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: 0; border-radius: var(--radius-sm);
  background: var(--accent); color: var(--accent-fg);
  font: inherit; font-weight: 700; font-size: 0.9rem;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out, transform 150ms ease-out;
}
button:hover:not(:disabled) { background: var(--accent-hover); }
button:active:not(:disabled) { transform: translateY(1px); }
button:disabled { opacity: 0.45; cursor: default; }
button.ghost { background: var(--surface-2); color: var(--text); font-weight: 600; }
button.ghost:hover:not(:disabled) { background: color-mix(in srgb, var(--surface-2) 88%, white 12%); }
button.danger {
  background: transparent; color: var(--err); font-weight: 600;
  border: 1px solid color-mix(in srgb, var(--err) 40%, transparent);
}
button.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--err) 15%, transparent); }
button.icon { padding: 0.4rem; background: transparent; color: var(--muted); }
button.icon:hover:not(:disabled) { color: var(--text); background: var(--surface-2); }
:is(button, a, input, select, textarea, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Segmented control (ses modu) */
.seg { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-2); border-radius: var(--radius-sm); }
.seg button { background: transparent; color: var(--muted); font-weight: 600; padding: 0.3rem 0.8rem; }
.seg button:hover:not(:disabled) { color: var(--text); background: transparent; }
.seg button.on { background: var(--accent); color: var(--accent-fg); }

/* ── Form ── */
input, textarea, select {
  width: 100%; padding: 0.55rem 0.7rem;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-2); color: inherit; font: inherit;
  transition: border-color 150ms ease-out;
}
input::placeholder, textarea::placeholder { color: color-mix(in srgb, var(--muted) 75%, transparent); }
input:focus, textarea:focus, select:focus { border-color: var(--accent); outline: none; }
textarea { min-height: 9rem; font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.55; }
label { color: var(--muted); font-size: 0.85rem; }

/* ── Kart ── */
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1rem 1.1rem; margin: 0.9rem 0;
  background: var(--surface); box-shadow: var(--shadow);
}
.card h2 {
  display: flex; align-items: center; gap: 0.5rem;
  margin: 0 0 0.8rem;
  font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
}
.card h2 .stage { color: var(--accent); font-family: var(--font-mono); font-weight: 600; }
.card h2 .muted { text-transform: none; letter-spacing: 0; font-weight: 500; }

/* ── Proje grid'i ── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.9rem; margin-top: 1rem; }
.tile {
  position: relative;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 1rem 1.1rem;
  transition: transform 150ms ease-out, border-color 150ms ease-out;
}
.tile:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.tile .title { display: block; font-weight: 700; padding-right: 3.4rem; }
.tile .sub { color: var(--muted); font-size: 0.82rem; margin-top: 0.3rem; }
.tile .actions { position: absolute; top: 0.55rem; right: 0.55rem; display: flex; gap: 0.2rem; opacity: 0; transition: opacity 150ms ease-out; }
.tile:hover .actions, .tile:focus-within .actions { opacity: 1; }

/* ── Bölüm satırları ── */
.rows { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.55rem; }
.rowitem {
  display: flex; align-items: center; gap: 0.8rem;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 0.6rem 0.9rem;
  transition: border-color 150ms ease-out;
}
.rowitem:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
.rowitem .pos { font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); background: var(--surface-2); border-radius: 6px; padding: 0.15rem 0.5rem; }
.rowitem .name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowitem .tools { display: flex; align-items: center; gap: 0.25rem; }

/* ── Rozetler ── */
.badge {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.12rem 0.55rem; border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em;
  background: var(--surface-2); color: var(--muted);
}
.badge.scripted { background: color-mix(in srgb, var(--info) 18%, transparent); color: var(--info); }
.badge.done { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.badge.error, .badge.failed { background: color-mix(in srgb, var(--err) 16%, transparent); color: var(--err); }
.badge.generating { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); animation: pulse 1.4s ease-in-out infinite; }

/* ── Tablo ── */
table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
th {
  text-align: left; padding: 0.4rem 0.55rem;
  color: var(--muted); font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border);
}
td { padding: 0.45rem 0.55rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); vertical-align: top; }
tbody tr:hover td { background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
td.mono { font-family: var(--font-mono); font-size: 0.8rem; }

/* ── İlerleme + eşitleyici (imza motifi) ── */
progress { width: 100%; height: 6px; appearance: none; border: 0; border-radius: 999px; overflow: hidden; background: var(--surface-2); }
progress::-webkit-progress-bar { background: var(--surface-2); }
progress::-webkit-progress-value { background: var(--accent); transition: width 200ms ease-out; }
progress::-moz-progress-bar { background: var(--accent); }

.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.eq span { width: 3px; border-radius: 1px; background: var(--accent); animation: eq 900ms ease-in-out infinite; }
.eq span:nth-child(2) { animation-delay: 150ms; }
.eq span:nth-child(3) { animation-delay: 300ms; }
.eq span:nth-child(4) { animation-delay: 450ms; }
.eq span:nth-child(5) { animation-delay: 600ms; }

/* ── Boş durum ── */
.empty {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  margin-top: 1rem; padding: 3rem 1rem;
  border: 1px dashed var(--border); border-radius: var(--radius);
  color: var(--muted); text-align: center;
}
.empty svg { color: color-mix(in srgb, var(--muted) 60%, transparent); }
.empty .t { font-weight: 700; color: var(--text); }

/* ── Oynatıcı + çeşitli ── */
.player { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.player audio { width: 100%; max-width: 26rem; height: 36px; }
.row { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.muted { color: var(--muted); font-size: 0.85rem; }
.err { color: var(--err); white-space: pre-wrap; font-size: 0.85rem; }
details { margin-top: 0.6rem; }
summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
summary:hover { color: var(--text); }
.spin { animation: spin 800ms linear infinite; }

/* ── Login ── */
.login-wrap {
  min-height: calc(100dvh - 10rem);
  display: grid; place-items: center;
  background: radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%);
}
.login { width: min(22rem, 92vw); text-align: center; }
.login .brandmark { color: var(--accent); margin-bottom: 0.4rem; }

/* ── Animasyonlar ── */
@keyframes eq { 0%, 100% { height: 4px; } 50% { height: 14px; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .crumbs a:not(:last-of-type) { display: none; }
  .crumbs .sep:first-of-type { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 2: Icon bileşenini oluştur**

`lib/ui/Icon.tsx`:

```tsx
import type { ReactElement } from 'react';

export type IconName =
  | 'play' | 'trash' | 'pencil' | 'up' | 'down' | 'plus'
  | 'person' | 'doc' | 'wave' | 'speaker' | 'warn' | 'logout' | 'spinner';

// Saf inline SVG ikon seti — bağımlılık yok; stroke tabanlı, currentColor.
const paths: Record<IconName, ReactElement> = {
  play: <path d="M5.5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none" />,
  trash: <><path d="M2.5 4.5h11" /><path d="M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5" /><path d="M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" /></>,
  pencil: <><path d="M11.3 2.2l2.5 2.5L5.5 13H3v-2.5z" /><path d="M9.8 3.7l2.5 2.5" /></>,
  up: <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />,
  down: <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />,
  plus: <path d="M8 3v10M3 8h10" />,
  person: <><circle cx="8" cy="5" r="2.6" /><path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" /></>,
  doc: <><path d="M4 1.8h5.2L12.5 5v9.2H4z" /><path d="M9 2v3h3" /></>,
  wave: <path d="M2 6v4M5 4v8M8 2v12M11 5v6M14 6.5v3" />,
  speaker: <><path d="M2.5 6v4h2.8L9 13V3L5.3 6z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5" /></>,
  warn: <><path d="M8 1.8 15 13.8H1z" /><path d="M8 6v4M8 11.8v.4" /></>,
  logout: <><path d="M6 2.5H3.5v11H6" /><path d="M10 5l3 3-3 3M13 8H7" /></>,
  spinner: <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" />,
};

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}
      className={name === 'spinner' ? 'spin' : undefined}
    >
      {paths[name]}
    </svg>
  );
}
```

- [ ] **Step 3: LogoutButton + layout.tsx**

`lib/ui/LogoutButton.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }
  return (
    <button className="icon" onClick={logout} aria-label="Çıkış yap" title="Çıkış yap">
      <Icon name="logout" />
    </button>
  );
}
```

`app/layout.tsx` tam içerik:

```tsx
import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { LogoutButton } from '@/lib/ui/LogoutButton';

const manrope = Manrope({ subsets: ['latin', 'latin-ext'], variable: '--font-manrope' });
const jbmono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-jbmono' });

export const metadata = { title: 'webnovel-tts panel' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${manrope.variable} ${jbmono.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            {/* Dalga-formu marka işareti */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="1" y="6" width="2.5" height="6" rx="1.25" fill="currentColor" />
              <rect x="5" y="3" width="2.5" height="12" rx="1.25" fill="currentColor" />
              <rect x="9" y="1" width="2.5" height="16" rx="1.25" fill="currentColor" opacity="0.85" />
              <rect x="13" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" />
            </svg>
            webnovel-tts
          </Link>
          <span className="spacer" />
          <LogoutButton />
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Doğrula**

Çalıştır: `npm run build && npm test`
Beklenen: build temiz (ilk build'te Google Fonts indirilir — internet gerekir, sonrası cache), 99 test PASS. Eski sayfa markup'ları yeni CSS ile bozulmadan çalışır (sınıf adları korundu).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx lib/ui/Icon.tsx lib/ui/LogoutButton.tsx
git commit -m "feat(ui): koyu stüdyo token sistemi + tipografi + app shell + ikon seti"
```

---

### Task 2: ConfirmButton + EmptyState bileşenleri

**Files:**
- Create: `lib/ui/ConfirmButton.tsx`
- Create: `lib/ui/EmptyState.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 1).
- Produces:
  - `ConfirmButton({ onConfirm, ariaLabel })` — ilk tık: danger "Emin misin?" (3 sn sonra sıfırlanır); ikinci tık: `onConfirm()`. `stopPropagation` yapar (tile içi Link'i tetiklemez).
  - `EmptyState({ icon, title, children? })` — `.empty` görünümü.

- [ ] **Step 1: Bileşenleri yaz**

`lib/ui/ConfirmButton.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// confirm() yerine iki aşamalı onay: ilk tık "Emin misin?"e dönüşür (3 sn), ikinci tık onaylar.
export function ConfirmButton({ onConfirm, ariaLabel = 'Sil' }: { onConfirm: () => void; ariaLabel?: string }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function click(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
    } else {
      clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
    }
  }

  return armed ? (
    <button className="danger" onClick={click}>Emin misin?</button>
  ) : (
    <button className="icon" onClick={click} aria-label={ariaLabel} title={ariaLabel}>
      <Icon name="trash" />
    </button>
  );
}
```

`lib/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <div className="t">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Doğrula + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS.

```bash
git add lib/ui/ConfirmButton.tsx lib/ui/EmptyState.tsx
git commit -m "feat(ui): ConfirmButton (confirm() ikamesi) + EmptyState bileşenleri"
```

---

### Task 3: Login sayfası

**Files:**
- Modify: `app/login/page.tsx` (tam değişim)

**Interfaces:**
- Consumes: `.login-wrap/.login/.brandmark` CSS (Task 1), `Icon`.
- Produces: — (davranış aynı: POST /api/auth/login → `/`).

- [ ] **Step 1: Sayfayı değiştir**

`app/login/page.tsx` tam içerik:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) router.push('/');
    else setErr((await res.json()).error ?? 'Giriş başarısız');
  }

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="card login">
        <div className="brandmark"><Icon name="wave" size={32} label="webnovel-tts" /></div>
        <h1>Giriş</h1>
        <p><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Panel şifresi" autoFocus /></p>
        {err && <p className="err">{err}</p>}
        <p><button type="submit" style={{ width: '100%' }}>Giriş yap</button></p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Doğrula + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS.

```bash
git add app/login/page.tsx
git commit -m "feat(ui): login sayfası — marka paneli + dalga zemin"
```

---

### Task 4: Projeler sayfası (kart grid'i)

**Files:**
- Modify: `app/page.tsx` (tam değişim)

**Interfaces:**
- Consumes: `.grid/.tile/.crumbs` CSS, `Icon`, `ConfirmButton`, `EmptyState`.
- Produces: — (davranış aynı: GET/POST/PATCH/DELETE /api/projects*; rename `prompt()` KORUNUR; silme onayı ConfirmButton'a geçer).

- [ ] **Step 1: Sayfayı değiştir**

`app/page.tsx` tam içerik:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { EmptyState } from '@/lib/ui/EmptyState';

type Project = { id: string; title: string; description: string | null; updatedAt: number };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [title, setTitle] = useState('');

  async function load() { setProjects(await (await fetch('/api/projects')).json()); }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    setTitle(''); load();
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }); load();
  }

  async function rename(p: Project) {
    const title = prompt('Yeni proje adı:', p.title);
    if (!title?.trim() || title === p.title) return;
    await fetch(`/api/projects/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
    load();
  }

  return (
    <>
      <div className="crumbs"><span className="here">Projeler</span></div>
      <h1>Projeler</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni proje adı" style={{ maxWidth: '20rem' }} />
        <button type="submit"><Icon name="plus" /> Ekle</button>
      </form>

      {projects === null && <p className="muted">Yükleniyor…</p>}

      {projects && projects.length > 0 && (
        <div className="grid">
          {projects.map((p) => (
            <div key={p.id} className="tile">
              <Link href={`/projects/${p.id}`} className="title">{p.title}</Link>
              <div className="sub">{new Date(p.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div className="actions">
                <button className="icon" onClick={() => rename(p)} aria-label="Yeniden adlandır" title="Yeniden adlandır"><Icon name="pencil" /></button>
                <ConfirmButton onConfirm={() => remove(p.id)} ariaLabel="Projeyi sil" />
              </div>
            </div>
          ))}
        </div>
      )}

      {projects && projects.length === 0 && (
        <EmptyState icon="doc" title="Henüz proje yok">İlk projeni yukarıdaki alandan ekle.</EmptyState>
      )}
    </>
  );
}
```

- [ ] **Step 2: Doğrula + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS.

```bash
git add app/page.tsx
git commit -m "feat(ui): projeler sayfası — kart grid'i + hover eylemler + boş durum"
```

---

### Task 5: Bölümler sayfası (satır listesi)

**Files:**
- Modify: `app/projects/[id]/page.tsx` (tam değişim)

**Interfaces:**
- Consumes: `.rows/.rowitem/.crumbs` CSS, `Icon`, `ConfirmButton`, `EmptyState`.
- Produces: — (davranış aynı: sıralama swap PATCH'leri, silme, ekleme korunur).

- [ ] **Step 1: Sayfayı değiştir**

`app/projects/[id]/page.tsx` tam içerik:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { EmptyState } from '@/lib/ui/EmptyState';

type Chapter = { id: string; title: string; position: number; status: string };
type Detail = { project: { id: string; title: string }; chapters: Chapter[] };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [title, setTitle] = useState('');

  async function load() {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setDetail(await res.json());
  }
  useEffect(() => { load(); }, [id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch(`/api/projects/${id}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    setTitle(''); load();
  }

  async function remove(chapterId: string) {
    await fetch(`/api/chapters/${chapterId}`, { method: 'DELETE' }); load();
  }

  async function move(idx: number, dir: -1 | 1) {
    const list = detail!.chapters;
    const a = list[idx], b = list[idx + dir];
    if (!b) return;
    await Promise.all([
      fetch(`/api/chapters/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: b.position }) }),
      fetch(`/api/chapters/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: a.position }) }),
    ]);
    load();
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  return (
    <>
      <div className="crumbs">
        <Link href="/">Projeler</Link>
        <span className="sep">›</span>
        <span className="here">{detail.project.title}</span>
      </div>
      <h1>{detail.project.title}</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni bölüm adı" style={{ maxWidth: '20rem' }} />
        <button type="submit"><Icon name="plus" /> Ekle</button>
      </form>

      {detail.chapters.length > 0 && (
        <div className="rows">
          {detail.chapters.map((c, i) => (
            <div key={c.id} className="rowitem">
              <span className="pos">{c.position}</span>
              <Link href={`/chapters/${c.id}`} className="name">{c.title}</Link>
              <span className={`badge ${c.status}`}>{c.status}</span>
              <span className="tools">
                <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Yukarı taşı" title="Yukarı taşı"><Icon name="up" /></button>
                <button className="icon" onClick={() => move(i, 1)} disabled={i === detail.chapters.length - 1} aria-label="Aşağı taşı" title="Aşağı taşı"><Icon name="down" /></button>
                <ConfirmButton onConfirm={() => remove(c.id)} ariaLabel="Bölümü sil" />
              </span>
            </div>
          ))}
        </div>
      )}

      {detail.chapters.length === 0 && (
        <EmptyState icon="doc" title="Henüz bölüm yok">İlk bölümü yukarıdaki alandan ekle.</EmptyState>
      )}
    </>
  );
}
```

- [ ] **Step 2: Doğrula + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS.

```bash
git add "app/projects/[id]/page.tsx"
git commit -m "feat(ui): bölümler sayfası — satır listesi + ikonlu araçlar + boş durum"
```

---

### Task 6: Çalışma alanı sayfası

**Files:**
- Modify: `app/chapters/[id]/page.tsx` (tam değişim — mevcut davranış AYNEN, görsel katman değişir)

**Interfaces:**
- Consumes: `.seg/.eq/.crumbs/.player` CSS, `Icon`, `EmptyState`; mevcut API sözleşmeleri (annotate SSE, cast-voice, script PUT, generate SSE).
- Produces: — Aşama numaralı kartlar: `01 Metin` → `02 Script` → `03 Üretim` (+ Segmentler).

- [ ] **Step 1: Sayfayı değiştir**

`app/chapters/[id]/page.tsx` tam içerik:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { VOICE_POOL } from '@/lib/voices-pool';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';

type Chapter = { id: string; projectId: string; title: string; rawText: string; narrationStyle: string | null; voiceMode: string; maxCharacters: number; status: string };
type Segment = { id: string; idx: number; speaker: string; style: string | null; text: string; status: string; error: string | null };
type Render = { id: string; path: string; durationSec: number | null; createdAt: number };
type CastMember = { character_id: string; display_name: string; voice_id: string; base_style?: string };
type ScriptInfo = { id: string; version: number; segmentCount: number; source: string; usage: { inputTokens: number; outputTokens: number; chunks: number } | null };
type Detail = { chapter: Chapter; script: ScriptInfo | null; cast: CastMember[]; segments: Segment[]; renders: Render[] };

// POST + SSE: EventSource sadece GET desteklediği için fetch-stream ile okunur.
async function streamSse(url: string, body: unknown, onEvent: (ev: string, data: any) => void) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      onEvent(ev, data ? JSON.parse(data) : null);
    }
  }
}

// Üretim/annotation sürerken oynayan eşitleyici (imza motifi).
function Eq() {
  return <span className="eq" aria-hidden="true"><span /><span /><span /><span /><span /></span>;
}

export default function ChapterPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rawText, setRawText] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [voiceMode, setVoiceMode] = useState('narrator');
  const [maxCharacters, setMaxCharacters] = useState(6);
  const [instruction, setInstruction] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [scriptErr, setScriptErr] = useState('');
  const [annState, setAnnState] = useState<{ busy: boolean; chunk: number; totalChunks: number; err: string }>({ busy: false, chunk: 0, totalChunks: 0, err: '' });
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string }>({ busy: false, done: 0, total: 0, err: '' });

  async function load() {
    const res = await fetch(`/api/chapters/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setRawText(d.chapter.rawText);
    setNarrationStyle(d.chapter.narrationStyle ?? '');
    setVoiceMode(d.chapter.voiceMode);
    setMaxCharacters(d.chapter.maxCharacters);
  }
  useEffect(() => { load(); }, [id]);

  async function saveText() {
    await fetch(`/api/chapters/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, narrationStyle, voiceMode, maxCharacters }),
    });
    load();
  }

  // LLM annotation: önce metin/mod kaydedilir, sonra SSE ile üretim izlenir.
  async function annotate(withInstruction: boolean) {
    setAnnState({ busy: true, chunk: 0, totalChunks: 0, err: '' });
    try {
      await saveText();
      await streamSse(`/api/chapters/${id}/annotate`, withInstruction && instruction.trim() ? { instruction: instruction.trim() } : {}, (ev, data) => {
        if (ev === 'progress') setAnnState((s) => ({ ...s, chunk: data.chunk, totalChunks: data.totalChunks }));
        if (ev === 'error') setAnnState((s) => ({ ...s, err: data.message }));
      });
      if (withInstruction) setInstruction('');
    } catch (e) {
      setAnnState((s) => ({ ...s, err: e instanceof Error ? e.message : 'Bağlantı hatası' }));
    } finally {
      setAnnState((s) => ({ ...s, busy: false }));
      load();
    }
  }

  async function changeVoice(characterId: string, voiceId: string) {
    const res = await fetch(`/api/chapters/${id}/cast-voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, voiceId }),
    });
    if (!res.ok) setScriptErr((await res.json()).error ?? 'Ses değiştirilemedi');
    load();
  }

  async function saveScript() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`, { method: 'PUT', body: scriptJson });
    if (res.ok) { setScriptJson(''); load(); }
    else setScriptErr((await res.json()).error ?? 'Script kaydedilemedi');
  }

  async function generate() {
    setGenState({ busy: true, done: 0, total: detail?.script?.segmentCount ?? 0, err: '' });
    try {
      await streamSse(`/api/chapters/${id}/generate`, {}, (ev, data) => {
        if (ev === 'progress') setGenState((s) => ({ ...s, done: data.done, total: data.total }));
        if (ev === 'error') setGenState((s) => ({ ...s, err: data.message }));
      });
    } catch (e) {
      setGenState((s) => ({ ...s, err: e instanceof Error ? e.message : 'Bağlantı hatası' }));
    } finally {
      setGenState((s) => ({ ...s, busy: false }));
      load();
    }
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  const { chapter, script, cast, segments, renders } = detail;
  const voiceOptions = (current: string) =>
    VOICE_POOL.some((v) => v.voiceId === current) ? VOICE_POOL : [{ voiceId: current, gender: 'male' as const, tone: 'mevcut' }, ...VOICE_POOL];

  return (
    <>
      <div className="crumbs">
        <Link href="/">Projeler</Link>
        <span className="sep">›</span>
        <Link href={`/projects/${chapter.projectId}`}>Bölümler</Link>
        <span className="sep">›</span>
        <span className="here">{chapter.title}</span>
      </div>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2><span className="stage">01</span> Metin &amp; anlatım {annState.busy && <Icon name="spinner" />}</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Bölümün ham metni" /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder="Anlatım tarzı (ör. sakin, gizemli, üçüncü şahıs)" /></p>
        <p className="row">
          <span className="seg" role="group" aria-label="Ses modu">
            <button type="button" className={voiceMode === 'narrator' ? 'on' : ''} onClick={() => setVoiceMode('narrator')}>Tek anlatıcı</button>
            <button type="button" className={voiceMode === 'multi' ? 'on' : ''} onClick={() => setVoiceMode('multi')}>Çok karakterli</button>
          </span>
          {voiceMode === 'multi' && (
            <label className="row">maks. karakter:
              <input type="number" min={1} max={12} value={maxCharacters} onChange={(e) => setMaxCharacters(Number(e.target.value) || 6)} style={{ width: '4.5rem' }} />
            </label>
          )}
        </p>
        <p className="row">
          <button className="ghost" onClick={saveText}>Kaydet</button>
          <button onClick={() => annotate(false)} disabled={annState.busy || !rawText.trim()}>
            <Icon name="wave" /> {annState.busy ? 'Üretiliyor…' : 'Script üret (LLM)'}
          </button>
          {annState.busy && <Eq />}
          {annState.busy && annState.totalChunks > 0 && <span className="muted">{annState.chunk}/{annState.totalChunks} parça</span>}
        </p>
        {annState.busy && annState.totalChunks > 1 && <progress value={annState.chunk} max={annState.totalChunks} />}
        {annState.err && <p className="err">{annState.err}</p>}
      </div>

      <div className="card">
        <h2>
          <span className="stage">02</span> Seslendirme script’i
          {script && (
            <span className="muted">
              v{script.version} · {script.segmentCount} segment · {script.source === 'llm' ? 'LLM' : 'elle'}
              {script.usage ? ` · ${script.usage.inputTokens}+${script.usage.outputTokens} token` : ''}
            </span>
          )}
        </h2>

        {cast.length > 0 && (
          <table>
            <thead><tr><th>Karakter</th><th>Ton</th><th>Ses</th></tr></thead>
            <tbody>
              {cast.map((c) => (
                <tr key={c.character_id}>
                  <td><span className="row" style={{ gap: '0.4rem' }}><Icon name="person" /> {c.display_name}</span></td>
                  <td className="muted">{c.base_style ?? ''}</td>
                  <td>
                    <select value={c.voice_id} onChange={(e) => changeVoice(c.character_id, e.target.value)} style={{ maxWidth: '16rem' }}>
                      {voiceOptions(c.voice_id).map((v) => (
                        <option key={v.voiceId} value={v.voiceId}>{v.voiceId.split(':')[1]} — {v.tone}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {script && (
          <p className="row">
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ek talimat (ör. daha az segment, Kaan daha öfkeli)" />
            <button className="ghost" onClick={() => annotate(true)} disabled={annState.busy}><Icon name="pencil" /> Yeniden üret</button>
          </p>
        )}

        {!script && !annState.busy && (
          <EmptyState icon="doc" title="Henüz script yok">Ham metni kaydedip “Script üret (LLM)” ile başla — ya da aşağıdan elle JSON yapıştır.</EmptyState>
        )}

        <details>
          <summary>Elle JSON yapıştır (gelişmiş)</summary>
          <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder="JSON script’i buraya yapıştır" /></p>
          <button className="ghost" onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
        </details>
        {scriptErr && <p className="err">{scriptErr}</p>}
      </div>

      <div className="card">
        <h2><span className="stage">03</span> Üretim {genState.busy && <Icon name="spinner" />}</h2>
        <p className="row">
          <button onClick={generate} disabled={!script || genState.busy}>
            <Icon name="play" /> {genState.busy ? 'Üretiliyor…' : 'Üret'}
          </button>
          {genState.busy && <Eq />}
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && <progress value={genState.done} max={genState.total} />}
        {genState.err && <p className="err">{genState.err}</p>}
        {renders.map((r) => (
          <p key={r.id} className="player">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? `${r.durationSec.toFixed(1)} sn` : ''} · {new Date(r.createdAt).toLocaleString('tr-TR')}</span>
          </p>
        ))}
      </div>

      {segments.length > 0 && (
        <div className="card">
          <h2><Icon name="speaker" /> Segmentler <span className="muted">{segments.length}</span></h2>
          <table>
            <thead><tr><th>#</th><th>Konuşan</th><th>Stil</th><th>Metin</th><th>Durum</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.idx + 1}</td>
                  <td>{s.speaker}</td>
                  <td className="muted">{s.style ?? ''}</td>
                  <td className="mono">{s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span>{s.error && <div className="err">{s.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Doğrula + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS.

```bash
git add "app/chapters/[id]/page.tsx"
git commit -m "feat(ui): çalışma alanı — aşamalı kartlar, segmented mod, eşitleyici animasyon"
```

---

### Task 7: Headless smoke + dokümantasyon

**Files:**
- Modify: `CLAUDE.md` (bir satır)

**Interfaces:** —

- [ ] **Step 1: Headless smoke (mock LLM + mock TTS)**

Git Bash; `.env`'e dokunmadan inline env ile:
1. `LLM_PROVIDER=mock TTS_PROVIDER=mock DATA_DIR=$(mktemp -d) npx next dev -p 3110 &` → `curl -s http://localhost:3110/api/projects` hazır olana dek bekle.
2. `curl -s http://localhost:3110/ | grep -o 'Projeler'` → çıktı var (sayfa render).
3. `curl -s http://localhost:3110/login | grep -o 'Giriş'` → var.
4. API üzerinden proje + bölüm oluştur; `curl -s http://localhost:3110/projects/<id> | grep -o 'webnovel-tts'` → shell render.
5. PATCH rawText (tırnaklı diyalog) + voiceMode multi → POST annotate → `event: done`; POST generate → `event: done`; `GET /api/audio/<renderPath>` → 200.
6. Server'ı kapat, temp sil.

Beklenen: hepsi geçer (davranış regresyonu yok kanıtı).

- [ ] **Step 2: CLAUDE.md güncelle**

"Ne yapıldı / ne kaldı" listesine Dilim B satırından SONRA ekle:

```markdown
- ✅ **UI Redesign — koyu stüdyo** (`docs/superpowers/specs/2026-07-17-panel-ui-redesign-design.md`): token sistemi, Manrope+JetBrains Mono (next/font), dalga-formu marka + eşitleyici animasyon, inline SVG ikonlar, ConfirmButton/EmptyState, 4 sayfa yeniden giydirildi. Davranış/API değişmedi.
```

- [ ] **Step 3: Son doğrulama + commit**

Çalıştır: `npm run build && npm test` → temiz + 99 PASS; `git status` → yalnız CLAUDE.md.

```bash
git add CLAUDE.md
git commit -m "docs: UI redesign durumu CLAUDE.md'ye işlendi"
```

---

## Doğrulama Özeti

| Kontrol | Komut | Beklenen |
|---|---|---|
| Testler | `npm test` | 99 PASS (değişmedi — UI-only) |
| Build | `npm run build` | Hatasız (ilk build font indirir) |
| Headless smoke | Task 7 Step 1 | Sayfalar render + ana akış çalışır |
| Görsel kabul | dev server + tarayıcı | **Kullanıcı onayı — merge öncesi zorunlu gate** |

---

## Ek Görevler — Sol panel klasör ağacı (spec §3.1 revizyonu)

> Görsel onay turunda kullanıcı istedi; aynı dalda devam. Ek kısıt: `GET /api/tree` bu revizyonun BİLİNÇLİ tek API eklemesidir (davranış değişikliği değil, salt-okur birleşim).

### Task 8: GET /api/tree endpoint'i

**Files:**
- Create: `app/api/tree/route.ts`
- Test: `tests/panel/api-tree.test.ts`

**Interfaces:**
- Consumes: `listProjects`, `listChapters` (mevcut servisler), `getDb/setDbForTests`.
- Produces: `GET /api/tree` → `[{ project: Project, chapters: Chapter[] }]` (projeler createdAt sıralı, bölümler position sıralı).

- [ ] **Step 1: Failing test yaz**

`tests/panel/api-tree.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import * as treeRoute from '@/app/api/tree/route';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

describe('GET /api/tree', () => {
  test('boş durumda boş dizi', async () => {
    expect(await (await treeRoute.GET()).json()).toEqual([]);
  });

  test('projeler + bölümleri sıralı döner', async () => {
    const p1 = createProject(db, { title: 'Roman' });
    const p2 = createProject(db, { title: 'Deneme' });
    createChapter(db, p1.id, { title: 'B1' });
    createChapter(db, p1.id, { title: 'B2' });
    const tree = await (await treeRoute.GET()).json();
    expect(tree).toHaveLength(2);
    expect(tree[0].project.title).toBe('Roman');
    expect(tree[0].chapters.map((c: any) => c.title)).toEqual(['B1', 'B2']);
    expect(tree[1].chapters).toEqual([]);
    expect(tree[0].chapters[0]).toMatchObject({ position: 1, status: 'draft' });
  });
});
```

- [ ] **Step 2: Fail doğrula** — `npx vitest run tests/panel/api-tree.test.ts` → FAIL (modül yok).

- [ ] **Step 3: Rotayı yaz**

`app/api/tree/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { listProjects } from '@/lib/services/projects';
import { listChapters } from '@/lib/services/chapters';

// Sol panel + (ileride) kütüphane için tek sorguda proje→bölüm ağacı.
export async function GET() {
  const db = getDb();
  return NextResponse.json(listProjects(db).map((project) => ({ project, chapters: listChapters(db, project.id) })));
}
```

- [ ] **Step 4: PASS + tüm testler** — `npx vitest run tests/panel/api-tree.test.ts` → PASS (2); `npm run build && npm test` → temiz + 101 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/tree/route.ts tests/panel/api-tree.test.ts
git commit -m "feat(panel): GET /api/tree — sol panel için proje→bölüm ağacı"
```

---

### Task 9: Sidebar bileşeni + shell entegrasyonu

**Files:**
- Modify: `lib/ui/Icon.tsx` (3 yeni ikon + className prop)
- Create: `lib/ui/Sidebar.tsx`
- Modify: `app/layout.tsx` (shell iki kolon)
- Modify: `app/globals.css` (sonuna panel CSS bloğu)

**Interfaces:**
- Consumes: `GET /api/tree` (Task 8), Icon, mevcut token'lar.
- Produces: `Sidebar` (client; `/login`'de null döner; `wnt:refresh` olayını dinler); `IconName`'e `chev | menu | folder` eklenir; `Icon` `className?` prop'u kazanır.

- [ ] **Step 1: Icon.tsx güncelle**

`IconName` union'ına ekle: `| 'chev' | 'menu' | 'folder'`. `paths`'e ekle:

```tsx
  chev: <path d="M6 3.5 10.5 8 6 12.5" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  folder: <path d="M1.8 4.5a1 1 0 0 1 1-1h3.4l1.5 1.6h5.5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />,
```

`Icon` imzasını genişlet — `className?: string` ekle:

```tsx
export function Icon({ name, size = 16, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
```

svg'nin `className` satırı şu olsun:

```tsx
      className={[name === 'spinner' ? 'spin' : '', className ?? ''].filter(Boolean).join(' ') || undefined}
```

- [ ] **Step 2: Sidebar.tsx oluştur**

`lib/ui/Sidebar.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

type Chapter = { id: string; title: string; position: number; status: string };
type Node = { project: { id: string; title: string }; chapters: Chapter[] };

// Sol panel: proje klasörleri → bölüm satırları. Navigasyon odaklı; yönetim sayfalarda.
export function Sidebar() {
  const pathname = usePathname();
  const [tree, setTree] = useState<Node[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/tree');
    if (res.ok) setTree(await res.json());
  }, []);

  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('wnt:refresh', h);
    return () => window.removeEventListener('wnt:refresh', h);
  }, [load]);
  useEffect(() => { setDrawer(false); }, [pathname]); // rota değişince drawer kapanır

  const chapterId = /^\/chapters\/([^/]+)/.exec(pathname)?.[1];

  // Aktif bölümün/projenin klasörünü otomatik aç
  useEffect(() => {
    if (!tree) return;
    const projFromUrl = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
    const active = chapterId ? tree.find((n) => n.chapters.some((c) => c.id === chapterId))?.project.id : projFromUrl;
    if (active) setOpen((s) => (s.has(active) ? s : new Set(s).add(active)));
  }, [tree, pathname, chapterId]);

  if (pathname === '/login') return null;

  function toggle(id: string) {
    setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <>
      <button className="side-toggle" onClick={() => setDrawer((d) => !d)} aria-label="Kütüphane menüsü" title="Kütüphane">
        <Icon name="menu" />
      </button>
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} />}
      <div className={drawer ? 'side-wrap open' : 'side-wrap'}>
        <nav className="side" aria-label="Kütüphane">
          {tree === null && <p className="muted">Yükleniyor…</p>}
          {tree?.map(({ project, chapters }) => (
            <div key={project.id} className="side-proj">
              <button className="side-head" onClick={() => toggle(project.id)} aria-expanded={open.has(project.id)}>
                <Icon name="chev" size={12} className="chev" />
                <Icon name="folder" size={14} />
                <span className="t">{project.title}</span>
                <span className="muted">{chapters.length}</span>
              </button>
              {open.has(project.id) && (
                <div className="side-list">
                  {chapters.map((c) => (
                    <Link key={c.id} href={`/chapters/${c.id}`} className={c.id === chapterId ? 'side-item on' : 'side-item'}>
                      <span className="pos">{c.position}</span>
                      <span className="t">{c.title}</span>
                      <span className={`dot ${c.status}`} title={c.status} />
                    </Link>
                  ))}
                  <Link href={`/projects/${project.id}`} className="side-item manage"><Icon name="pencil" size={12} /> Yönet</Link>
                </div>
              )}
            </div>
          ))}
          {tree !== null && <Link href="/" className="side-item manage"><Icon name="plus" size={12} /> Yeni proje</Link>}
        </nav>
      </div>
    </>
  );
}
```

- [ ] **Step 3: layout.tsx shell'i iki kolona çevir**

`app/layout.tsx`'te import ekle: `import { Sidebar } from '@/lib/ui/Sidebar';` ve `<body>` içeriğini şu yapıya getir (topbar içeriği AYNEN kalır):

```tsx
      <body>
        <header className="topbar">
          {/* ...mevcut brand + spacer + LogoutButton aynen... */}
        </header>
        <div className="shell">
          <Sidebar />
          <main className="container">{children}</main>
        </div>
      </body>
```

- [ ] **Step 4: globals.css sonuna panel bloğu ekle**

```css
/* ── Sol panel (klasör ağacı) ── */
.topbar { height: 3.4rem; }
.shell { display: flex; align-items: flex-start; }
.shell .container { flex: 1; min-width: 0; }
.side-wrap {
  width: 240px; flex-shrink: 0;
  position: sticky; top: 3.4rem; height: calc(100dvh - 3.4rem);
  overflow-y: auto; padding: 0.8rem 0.6rem;
  background: var(--surface); border-right: 1px solid var(--border);
}
.side-proj { margin-bottom: 0.2rem; }
.side-head {
  display: flex; align-items: center; gap: 0.45rem; width: 100%;
  background: transparent; color: var(--text);
  font-weight: 700; font-size: 0.86rem; text-align: left;
  padding: 0.4rem 0.5rem; border-radius: var(--radius-sm);
}
.side-head:hover:not(:disabled) { background: var(--surface-2); }
.side-head .chev { color: var(--muted); transition: transform 150ms ease-out; flex-shrink: 0; }
.side-head[aria-expanded="true"] .chev { transform: rotate(90deg); }
.side-head .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-head .muted { font-size: 0.72rem; }
.side-list { display: flex; flex-direction: column; gap: 1px; margin: 0.1rem 0 0.4rem 1.05rem; border-left: 1px solid var(--border); padding-left: 0.5rem; }
.side-item { display: flex; align-items: center; gap: 0.45rem; padding: 0.3rem 0.5rem; border-radius: var(--radius-sm); font-size: 0.85rem; color: var(--muted); }
.side-item:hover { background: var(--surface-2); color: var(--text); }
.side-item.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text); font-weight: 600; }
.side-item .pos { font-family: var(--font-mono); font-size: 0.72rem; flex-shrink: 0; }
.side-item .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-item.manage { font-size: 0.78rem; }
.dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); flex-shrink: 0; }
.dot.scripted { background: var(--info); }
.dot.done { background: var(--ok); }
.dot.error { background: var(--err); }
.dot.generating { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
.dot.draft { opacity: 0.5; }
.side-scrim { display: none; }
.side-toggle { display: none; }

@media (max-width: 900px) {
  .side-wrap {
    position: fixed; left: 0; top: 3.4rem; bottom: 0; height: auto;
    width: min(280px, 80vw); z-index: 20;
    transform: translateX(-100%); transition: transform 200ms ease-out;
    box-shadow: var(--shadow);
  }
  .side-wrap.open { transform: none; }
  .side-scrim { display: block; position: fixed; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.5); }
  .side-toggle {
    display: inline-flex; position: fixed; right: 1rem; bottom: 1rem; z-index: 25;
    background: var(--accent); color: var(--accent-fg);
    border-radius: 999px; padding: 0.85rem; box-shadow: var(--shadow);
  }
}
```

- [ ] **Step 5: Doğrula + commit** — `npm run build && npm test` → temiz + 101 PASS.

```bash
git add lib/ui/Icon.tsx lib/ui/Sidebar.tsx app/layout.tsx app/globals.css
git commit -m "feat(ui): sol panel — proje klasör ağacı + mobil drawer"
```

---

### Task 10: Mutasyon sonrası panel tazeleme + smoke

**Files:**
- Create: `lib/ui/refresh.ts`
- Modify: `app/page.tsx`, `app/projects/[id]/page.tsx`, `app/chapters/[id]/page.tsx` (yalnız `refreshTree()` çağrıları eklenir — BAŞKA HİÇBİR ŞEY DEĞİŞMEZ)

**Interfaces:**
- Consumes: `wnt:refresh` dinleyicisi (Task 9).
- Produces: `refreshTree(): void`.

- [ ] **Step 1: refresh.ts**

`lib/ui/refresh.ts`:

```ts
// Sol panelin ağacını tazeler (Sidebar 'wnt:refresh' olayını dinler).
export function refreshTree(): void {
  window.dispatchEvent(new Event('wnt:refresh'));
}
```

- [ ] **Step 2: Sayfalara çağrıları ekle**

Her üç sayfaya import: `import { refreshTree } from '@/lib/ui/refresh';`

- `app/page.tsx`: `create`, `remove`, `rename` fonksiyonlarında son `load();` çağrısından ÖNCE `refreshTree();` satırı.
- `app/projects/[id]/page.tsx`: `create`, `remove`, `move` içinde aynı şekilde.
- `app/chapters/[id]/page.tsx`: `annotate` ve `generate` fonksiyonlarının `finally` bloğunda `load();`'dan önce `refreshTree();`; `saveScript` başarı dalında `setScriptJson('');` ile `load();` arasına `refreshTree();` (durum rozetleri değişir).

- [ ] **Step 3: Headless smoke**

Mock LLM+TTS, port 3120, throwaway DATA_DIR (Task 7 desenindeki süreç yönetimiyle — netstat PID + taskkill):
1. `GET /api/tree` → `[]` (200).
2. Proje + 2 bölüm oluştur → `GET /api/tree` → 1 proje, 2 bölüm sıralı.
3. `GET /` → HTML `Projeler` içerir (sayfa hâlâ çalışıyor).
4. annotate + generate akışı (kısa) → `GET /api/tree`'de bölüm status `done`.
5. Temizlik.

- [ ] **Step 4: Doğrula + commit** — `npm run build && npm test` → temiz + 101 PASS.

```bash
git add lib/ui/refresh.ts app/page.tsx "app/projects/[id]/page.tsx" "app/chapters/[id]/page.tsx"
git commit -m "feat(ui): mutasyon sonrası sol panel tazeleme + smoke"
```
