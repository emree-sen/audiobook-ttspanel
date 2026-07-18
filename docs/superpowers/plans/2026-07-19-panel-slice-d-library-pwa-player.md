# Dilim D — Kütüphane + PWA Oynatıcı Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Üretilen bölümleri dinleme deneyimine çevirmek: `/library` sayfası, DB'de resume, global alt çubuk oynatıcı (MediaSession, hız, 15/30 atlama, otomatik sonraki), PWA kurulumu ve indir-düğmeli offline çalma.

**Architecture:** `listening_progress` tablosu + `lib/services/library.ts`; global `PlayerProvider` (tek `<audio>`, layout'ta — rota değişiminde ses kesilmez) + `PlayerBar`; elle yazılmış `public/sw.js` (audio cache-first + **Range→206 dilimleme**, library network-first+fallback, navigasyon offline'da `/library` kabuğu); indirmeler istemci Cache API'siyle (`wnt-v1-audio`).

**Tech Stack:** Next.js 15 App Router, Drizzle + better-sqlite3, saf CSS token sistemi, Service Worker + Cache Storage + MediaSession API (bağımlılık YOK — workbox yok).

**Spec:** `docs/superpowers/specs/2026-07-19-panel-slice-d-library-pwa-player-design.md`

## Global Constraints

- Tüm UI metinleri ve hata mesajları **Türkçe**; Türkçe karakterler birebir korunur.
- Yeni npm bağımlılığı YOK (`package.json` dependencies değişmez); `src/core` DEĞİŞMEZ.
- Cache adları sw.js `VERSION = 'wnt-v1'` ile başlar; istemci `lib/ui/player/offline.ts` içindeki `AUDIO_CACHE = 'wnt-v1-audio'` sabiti sw.js'in audio cache adıyla BİREBİR AYNI olmalı (iki dosyada da yorumla çapraz referans verilir).
- Ses cache anahtarı: `/api/audio/<renderPath>` (pathname); sw.js audio isteklerini `ignoreSearch` ile pathname üzerinden eşler.
- Hız seçenekleri: 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 — `localStorage['wnt:rate']`. Atlamalar: geri 15 sn, ileri 30 sn.
- İlerleme kaydı: çalarken ~5 sn'de bir + `pause`/`ended`/`visibilitychange(hidden)` anında; ağ hatası sessizce yutulur.
- `middleware.ts` PUBLIC'e yalnız şunlar eklenir: `/manifest.webmanifest`, `/sw.js`, `/icons/` — sayfalar, API ve ses AUTH'LU kalır.
- SW kaydı yalnız production'da (`process.env.NODE_ENV !== 'production'` ise atla).
- Kütüphanede yalnız `done` (oynatılabilir) ve `voiced` ("Birleştir bekliyor", oynatılamaz) bölümler görünür.
- Her task sonunda `npx tsc --noEmit` temiz + tam `npm test` yeşil (başlangıç: 35 dosya / 193 test); UI/PWA task'larında ek `npm run build`.
- Commit mesajları Türkçe; gövde sonu: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Şema 0004 (listening_progress) + library servisi

**Files:**
- Modify: `lib/db/schema.ts` (tablo eklenir)
- Create: `drizzle/0004_d_library.sql` (drizzle-kit üretir: `npm run db:generate -- --name d_library`)
- Create: `lib/services/library.ts`
- Test: `tests/panel/library.test.ts`

**Interfaces:**
- Consumes: `listProjects`, `listChapters`, `getChapter`, `listRenders`.
- Produces (sonraki task'lar bunlara güvenir):
  - `LibraryChapter { id: string; title: string; position: number; status: string; renderPath: string | null; durationSec: number | null; progressSec: number | null; progressUpdatedAt: number }`
  - `LibrarySeries { project: { id: string; title: string }; chapters: LibraryChapter[] }`
  - `getLibrary(db: Db): LibrarySeries[]` · `saveProgress(db: Db, chapterId: string, p: { positionSec: number; durationSec?: number }): void` (bilinmeyen bölümde Türkçe hata fırlatır)

- [ ] **Step 1: Failing test yaz** — `tests/panel/library.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, updateChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { enqueueJob, runJob, stitchLatest } from '@/lib/services/producer';
import { getLibrary, saveProgress } from '@/lib/services/library';
import { MockAdapter } from '@/src/core/tts/mock';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

async function makeDone(db: Db, projectId: string, title: string) {
  const c = createChapter(db, projectId, { title });
  importScript(db, c.id, FIXTURE);
  const job = enqueueJob(db, c.id);
  await runJob(db, job.id, new MockAdapter());
  await stitchLatest(db, c.id); // status: done + render
  return c;
}

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('getLibrary', () => {
  test('yalnız done+voiced listelenir; done son render + süre taşır; boş seri düşer', async () => {
    const p = createProject(db, { title: 'Roman' });
    const done = await makeDone(db, p.id, 'B1');
    const voiced = createChapter(db, p.id, { title: 'B2' });
    importScript(db, voiced.id, FIXTURE);
    const j = enqueueJob(db, voiced.id);
    await runJob(db, j.id, new MockAdapter()); // voiced (stitch yok)
    createChapter(db, p.id, { title: 'B3' }); // draft — görünmez
    createProject(db, { title: 'Boş Seri' }); // bölümsüz — düşer

    const lib = getLibrary(db);
    expect(lib).toHaveLength(1);
    expect(lib[0].project.title).toBe('Roman');
    expect(lib[0].chapters.map((c) => c.status)).toEqual(['done', 'voiced']);
    const d = lib[0].chapters[0];
    expect(d.renderPath).toMatch(new RegExp(`^${done.id}/rnd_`));
    expect(d.durationSec).toBeGreaterThan(0);
    expect(lib[0].chapters[1].renderPath).toBeNull(); // voiced: oynatılamaz
  });
  test('progress join: kayıt varsa progressSec + progressUpdatedAt dolar', async () => {
    const p = createProject(db, { title: 'R' });
    const c = await makeDone(db, p.id, 'B1');
    saveProgress(db, c.id, { positionSec: 42.5, durationSec: 120 });
    const row = getLibrary(db)[0].chapters[0];
    expect(row.progressSec).toBe(42.5);
    expect(row.progressUpdatedAt).toBeGreaterThan(0);
  });
});

describe('saveProgress', () => {
  test('upsert: ikinci yazış günceller; durationSec verilmezse eskisi korunur', async () => {
    const p = createProject(db, { title: 'R' });
    const c = await makeDone(db, p.id, 'B1');
    saveProgress(db, c.id, { positionSec: 10, durationSec: 100 });
    saveProgress(db, c.id, { positionSec: 20 });
    const row = getLibrary(db)[0].chapters[0];
    expect(row.progressSec).toBe(20);
    // durationSec tabloda korunur (yanıtta render süresi döner; tablo değeri ayrı sorgulanır)
  });
  test('bilinmeyen bölüm Türkçe hata', () => {
    expect(() => saveProgress(db, 'chp_yok', { positionSec: 1 })).toThrow(/bulunamadı/i);
  });
});
```

- [ ] **Step 2: FAIL doğrula** — `npm test -- tests/panel/library.test.ts` (modül yok).

- [ ] **Step 3: Şema + migration** — `lib/db/schema.ts` sonuna:

```ts
export const listeningProgress = sqliteTable('listening_progress', {
  chapterId: text('chapter_id').primaryKey().references(() => chapters.id, { onDelete: 'cascade' }),
  positionSec: real('position_sec').notNull().default(0),
  durationSec: real('duration_sec'),
  updatedAt: integer('updated_at').notNull(),
});
```

Sonra: `npm run db:generate -- --name d_library` → `drizzle/0004_d_library.sql` (tek CREATE TABLE; tohum yok).

- [ ] **Step 4: `lib/services/library.ts` yaz**:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { listeningProgress } from '../db/schema';
import { listProjects } from './projects';
import { getChapter, listChapters } from './chapters';
import { listRenders } from './generation';

export interface LibraryChapter {
  id: string; title: string; position: number; status: string;
  renderPath: string | null; durationSec: number | null;
  progressSec: number | null; progressUpdatedAt: number;
}
export interface LibrarySeries { project: { id: string; title: string }; chapters: LibraryChapter[] }

// Kütüphane: yalnız dinlenebilir (done) ve birleştirme bekleyen (voiced) bölümler.
export function getLibrary(db: Db): LibrarySeries[] {
  const out: LibrarySeries[] = [];
  for (const project of listProjects(db)) {
    const rows = listChapters(db, project.id).filter((c) => c.status === 'done' || c.status === 'voiced');
    if (rows.length === 0) continue;
    const chapters = rows.map((c) => {
      const render = c.status === 'done' ? listRenders(db, c.id)[0] : undefined;
      const prog = db.select().from(listeningProgress).where(eq(listeningProgress.chapterId, c.id)).get();
      return {
        id: c.id, title: c.title, position: c.position, status: c.status,
        renderPath: render?.path ?? null, durationSec: render?.durationSec ?? null,
        progressSec: prog?.positionSec ?? null, progressUpdatedAt: prog?.updatedAt ?? 0,
      };
    });
    out.push({ project: { id: project.id, title: project.title }, chapters });
  }
  return out;
}

export function saveProgress(db: Db, chapterId: string, p: { positionSec: number; durationSec?: number }): void {
  if (!getChapter(db, chapterId)) throw new Error('Bölüm bulunamadı');
  const now = Date.now();
  db.insert(listeningProgress)
    .values({ chapterId, positionSec: p.positionSec, durationSec: p.durationSec ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: listeningProgress.chapterId,
      set: { positionSec: p.positionSec, ...(p.durationSec != null ? { durationSec: p.durationSec } : {}), updatedAt: now },
    }).run();
}
```

- [ ] **Step 5: Testler + tam suite + tsc** — hepsi yeşil/temiz.

- [ ] **Step 6: Commit** — `git add lib/db/schema.ts drizzle/ lib/services/library.ts tests/panel/library.test.ts` → `feat(panel): listening_progress şeması + kütüphane servisi`

---

### Task 2: API rotaları — GET /api/library + PUT /api/progress/[chapterId]

**Files:**
- Create: `app/api/library/route.ts`
- Create: `app/api/progress/[chapterId]/route.ts`
- Test: `tests/panel/api-library.test.ts`

**Interfaces:**
- Consumes: Task 1 servisleri.
- Produces: `GET /api/library` → `LibrarySeries[]` · `PUT /api/progress/[chapterId]` gövde `{ positionSec: number, durationSec?: number }` → `{ ok: true }` | 400 (geçersiz sayı) | 404 (bölüm yok).

- [ ] **Step 1: Failing test yaz** — `tests/panel/api-library.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { enqueueJob, runJob, stitchLatest } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';
import * as libraryRoute from '@/app/api/library/route';
import * as progressRoute from '@/app/api/progress/[chapterId]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (chapterId: string) => ({ params: Promise.resolve({ chapterId }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let db: Db, chapterId: string;
beforeEach(async () => {
  db = createDb(':memory:'); setDbForTests(db);
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  chapterId = c.id;
  importScript(db, c.id, FIXTURE);
  const job = enqueueJob(db, c.id);
  await runJob(db, job.id, new MockAdapter());
  await stitchLatest(db, c.id);
});

describe('GET /api/library', () => {
  test('serileri ve oynatılabilir bölümü döner', async () => {
    const lib = await (await libraryRoute.GET()).json();
    expect(lib).toHaveLength(1);
    expect(lib[0].chapters[0].renderPath).toBeTruthy();
  });
});

describe('PUT /api/progress/[chapterId]', () => {
  test('kaydeder; library yanıtına yansır', async () => {
    const res = await progressRoute.PUT(jsonReq('PUT', { positionSec: 33, durationSec: 90 }), ctx(chapterId));
    expect(res.status).toBe(200);
    const lib = await (await libraryRoute.GET()).json();
    expect(lib[0].chapters[0].progressSec).toBe(33);
  });
  test('geçersiz sayı 400 (negatif, sonsuz, eksik); bilinmeyen bölüm 404', async () => {
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: -1 }), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', {}), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: Infinity }), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: 5 }), ctx('chp_yok'))).status).toBe(404);
  });
});
```

(Not: `JSON.stringify({positionSec: Infinity})` → `{"positionSec":null}` üretir — rota tip kontrolü bunu da 400'e düşürür; test bu yüzden geçerlidir.)

- [ ] **Step 2: FAIL doğrula.**

- [ ] **Step 3: Rotaları yaz:**

`app/api/library/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getLibrary } from '@/lib/services/library';

export async function GET() {
  return NextResponse.json(getLibrary(getDb()));
}
```

`app/api/progress/[chapterId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { saveProgress } from '@/lib/services/library';

const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export async function PUT(req: Request, { params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId } = await params;
  const b = await req.json().catch(() => ({}));
  if (!okNum(b.positionSec) || (b.durationSec !== undefined && !okNum(b.durationSec)))
    return NextResponse.json({ error: 'positionSec (ve varsa durationSec) sonlu ve ≥ 0 olmalı' }, { status: 400 });
  try {
    saveProgress(getDb(), chapterId, { positionSec: b.positionSec, durationSec: b.durationSec });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
```

- [ ] **Step 4: Testler + tam suite + tsc.**

- [ ] **Step 5: Commit** — `feat(panel): kütüphane + ilerleme API rotaları`

---

### Task 3: PWA statikleri — manifest, ikonlar, sw.js, middleware, SW kaydı

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icons/icon.svg`, `public/icons/maskable.svg`
- Create: `public/sw.js`
- Modify: `middleware.ts:4` (PUBLIC listesi)
- Create: `lib/ui/player/RegisterSw.tsx`
- Modify: `app/layout.tsx` (metadata/viewport + RegisterSw)

**Interfaces:**
- Produces: cache adları `wnt-v1-audio` / `wnt-v1-static` / `wnt-v1-shell` / `wnt-v1-meta` (Task 4 offline.ts `wnt-v1-audio`'yu kullanır); `/manifest.webmanifest`, `/sw.js`, `/icons/*` auth'suz erişilebilir.

- [ ] **Step 1: manifest + ikonlar yaz:**

`public/manifest.webmanifest`:

```json
{
  "name": "webnovel-tts",
  "short_name": "webnovel-tts",
  "start_url": "/library",
  "display": "standalone",
  "background_color": "#0f1115",
  "theme_color": "#0f1115",
  "icons": [
    { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "/icons/maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

`public/icons/icon.svg` (dalga-formu marka; amber çubuklar, koyu zemin):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f1115"/>
  <g fill="#f59e0b">
    <rect x="96" y="196" width="56" height="120" rx="28"/>
    <rect x="184" y="136" width="56" height="240" rx="28"/>
    <rect x="272" y="96" width="56" height="320" rx="28" opacity="0.85"/>
    <rect x="360" y="176" width="56" height="160" rx="28"/>
  </g>
</svg>
```

`public/icons/maskable.svg` (aynı motif, güvenli alan için %20 iç boşluk):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f1115"/>
  <g fill="#f59e0b">
    <rect x="148" y="221" width="42" height="90" rx="21"/>
    <rect x="214" y="176" width="42" height="180" rx="21"/>
    <rect x="280" y="146" width="42" height="240" rx="21" opacity="0.85"/>
    <rect x="346" y="206" width="42" height="120" rx="21"/>
  </g>
</svg>
```

- [ ] **Step 2: `public/sw.js` yaz** (tamamı — Range/206 dilimleme dahil):

```js
// webnovel-tts service worker — elle yazılmış (workbox yok).
// VERSION, istemcideki lib/ui/player/offline.ts AUDIO_CACHE sabitiyle eşleşmeli (wnt-v1-audio).
const VERSION = 'wnt-v1';
const AUDIO = `${VERSION}-audio`;
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const META = `${VERSION}-meta`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Cache'teki TAM yanıttan Range dilimi üret (206) — yoksa offline seek ve iOS çalma kırılır.
async function rangedResponse(req, res) {
  const range = req.headers.get('range');
  if (!range || res.status !== 200) return res;
  const m = /bytes=(\d+)-(\d+)?/.exec(range);
  if (!m) return res;
  const buf = await res.arrayBuffer();
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  if (start >= buf.byteLength) return new Response(null, { status: 416 });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // İndirilen sesler: cache-first (Range destekli); yoksa ağ.
  if (url.pathname.startsWith('/api/audio/')) {
    e.respondWith((async () => {
      const hit = await (await caches.open(AUDIO)).match(url.pathname, { ignoreSearch: true, ignoreVary: true });
      if (hit) return rangedResponse(e.request, hit.clone());
      return fetch(e.request);
    })());
    return;
  }

  // Kütüphane verisi: network-first, offline'da son başarılı yanıt.
  if (url.pathname === '/api/library') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) (await caches.open(META)).put('/api/library', res.clone());
        return res;
      } catch {
        const hit = await caches.match('/api/library');
        return hit ?? Response.json({ error: 'Çevrimdışı — kütüphane önbelleği yok' }, { status: 503 });
      }
    })());
    return;
  }

  // Hash'li statikler: cache-first (güvenle bayatlamaz).
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // Navigasyon: network-first; offline'da /library kabuğu.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok && url.pathname === '/library') (await caches.open(SHELL)).put('/library', res.clone());
        return res;
      } catch {
        const hit = await caches.match('/library');
        return hit ?? new Response('Çevrimdışı — kütüphane önbelleği yok', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
  }
});
```

- [ ] **Step 3: middleware PUBLIC güncelle** — `middleware.ts:4`:

```ts
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//];
```

- [ ] **Step 4: `lib/ui/player/RegisterSw.tsx` yaz + layout'a bağla:**

```tsx
'use client';
import { useEffect } from 'react';

// SW kaydı yalnız üretim build'inde — dev'de HMR ile çakışır.
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
```

`app/layout.tsx`: metadata'ya manifest + viewport ekle (mevcut `export const metadata` satırını değiştir, viewport'u AYRI export olarak ekle — Next 15 kuralı):

```ts
export const metadata = { title: 'webnovel-tts panel', manifest: '/manifest.webmanifest' };
export const viewport = { themeColor: '#0f1115' };
```

`<body>` içinde en üste `<RegisterSw />` ekle (import: `import { RegisterSw } from '@/lib/ui/player/RegisterSw';`).

- [ ] **Step 5: Doğrula** — `npx tsc --noEmit` temiz; `npm run build` temiz; `npm test` tam suite yeşil (değişmemeli). Manuel hızlı kontrol: build çıktısında `/manifest.webmanifest` ve `/sw.js` dosyalarının `.next` tarafından değil `public/`ten servis edileceği (Next varsayılanı — ekstra iş yok).

- [ ] **Step 6: Commit** — `feat(panel): PWA temeli — manifest, SVG ikonlar, service worker (Range destekli), SW kaydı`

---

### Task 4: Oynatıcı çekirdeği — offline.ts, PlayerProvider, PlayerBar, ikonlar, CSS, layout bağlama

**Files:**
- Create: `lib/ui/player/offline.ts`
- Create: `lib/ui/player/PlayerProvider.tsx`
- Create: `lib/ui/player/PlayerBar.tsx`
- Modify: `lib/ui/Icon.tsx` (yeni ikonlar: `pause`, `next`, `back15`, `fwd30`, `download`, `check`, `headphones`)
- Modify: `app/globals.css` (playerbar stilleri)
- Modify: `app/layout.tsx` (Provider + Bar)

**Interfaces:**
- Consumes: Task 2 `PUT /api/progress/[chapterId]`; Task 3 cache adı `wnt-v1-audio`.
- Produces (Task 5 kullanır):
  - `PlayerTrack { chapterId: string; title: string; seriesTitle: string; src: string; durationSec: number | null; progressSec: number | null }`
  - `usePlayer(): { track, playing, position, duration, rate, playChapter(t: PlayerTrack, queue?: PlayerTrack[]), toggle(), seekBy(s), seekTo(s), setRate(r), next(), prev() }`
  - `offline.ts`: `audioUrl(renderPath): string` · `downloadChapter(renderPath): Promise<boolean>` · `removeDownload(renderPath): Promise<void>` · `downloadedSet(): Promise<Set<string>>` (renderPath kümesi) · `storageEstimateText(): Promise<string | null>`

- [ ] **Step 1: `lib/ui/player/offline.ts` yaz:**

```ts
// İndirme yönetimi: Cache Storage (sw.js bu cache'ten cache-first servis eder).
// AUDIO_CACHE, public/sw.js VERSION'ı ile eşleşmeli (wnt-v1).
const AUDIO_CACHE = 'wnt-v1-audio';

export function audioUrl(renderPath: string): string { return `/api/audio/${renderPath}`; }

export async function downloadChapter(renderPath: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const res = await fetch(audioUrl(renderPath));
  if (!res.ok) return false;
  await (await caches.open(AUDIO_CACHE)).put(audioUrl(renderPath), res);
  return true;
}

export async function removeDownload(renderPath: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  await (await caches.open(AUDIO_CACHE)).delete(audioUrl(renderPath), { ignoreSearch: true });
}

export async function downloadedSet(): Promise<Set<string>> {
  if (typeof caches === 'undefined') return new Set();
  const keys = await (await caches.open(AUDIO_CACHE)).keys();
  return new Set(keys.map((r) => new URL(r.url).pathname.replace(/^\/api\/audio\//, '')));
}

export async function storageEstimateText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage } = await navigator.storage.estimate();
  return usage != null ? `${(usage / 1024 / 1024).toFixed(1)} MB` : null;
}
```

- [ ] **Step 2: `lib/ui/player/PlayerProvider.tsx` yaz:**

```tsx
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type PlayerTrack = {
  chapterId: string; title: string; seriesTitle: string;
  src: string; durationSec: number | null; progressSec: number | null;
};

type PlayerCtx = {
  track: PlayerTrack | null; playing: boolean; position: number; duration: number; rate: number;
  playChapter: (t: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void; seekBy: (s: number) => void; seekTo: (s: number) => void;
  setRate: (r: number) => void; next: () => void; prev: () => void; hasNext: boolean; hasPrev: boolean;
};

const Ctx = createContext<PlayerCtx | null>(null);
export function usePlayer(): PlayerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer, PlayerProvider içinde kullanılmalı');
  return v;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayerTrack[]>([]);
  const trackRef = useRef<PlayerTrack | null>(null); // callback'ler için güncel parça (bayat closure önlemi)
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);

  // Tek <audio> elemanı — rota değişse de yaşar.
  function audio(): HTMLAudioElement {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'metadata';
      audioRef.current = el;
    }
    return audioRef.current;
  }

  const saveProgress = useCallback((chapterId: string, pos: number, dur: number) => {
    // Ağ hatası sessizce yutulur — dinleme kesilmez; keepalive: sekme kapanırken de gitsin.
    fetch(`/api/progress/${chapterId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ positionSec: Math.floor(pos * 10) / 10, ...(dur > 0 ? { durationSec: Math.floor(dur * 10) / 10 } : {}) }),
    }).catch(() => {});
  }, []);

  // idx her zaman trackRef üzerinden okur — next/prev callback'leri track state'ine bağımlı olmadan güncel kalır.
  const idx = () => queueRef.current.findIndex((q) => q.chapterId === trackRef.current?.chapterId);
  const curIdx = queueRef.current.findIndex((q) => q.chapterId === track?.chapterId);
  const hasNext = track != null && curIdx >= 0 && curIdx < queueRef.current.length - 1;
  const hasPrev = track != null && curIdx > 0;

  const start = useCallback((t: PlayerTrack) => {
    const el = audio();
    trackRef.current = t;
    setTrack(t);
    el.src = t.src;
    // Resume: kalınan yerden; bitmişse baştan.
    const startAt = t.progressSec != null && t.durationSec != null && t.progressSec < t.durationSec - 5 ? t.progressSec : 0;
    el.currentTime = startAt;
    setPosition(startAt);
    el.playbackRate = rate;
    void el.play().catch(() => setPlaying(false));
  }, [rate]);

  const playChapter = useCallback((t: PlayerTrack, queue?: PlayerTrack[]) => {
    if (queue) queueRef.current = queue;
    else if (!queueRef.current.some((q) => q.chapterId === t.chapterId)) queueRef.current = [t];
    start(t);
  }, [start]);

  const next = useCallback(() => {
    const i = idx();
    if (i >= 0 && i < queueRef.current.length - 1) start(queueRef.current[i + 1]);
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = useCallback(() => {
    const i = idx();
    if (i > 0) start(queueRef.current[i - 1]);
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hız: localStorage'dan yükle / değişince yaz + uygula.
  useEffect(() => {
    const saved = Number(localStorage.getItem('wnt:rate'));
    if (RATES.includes(saved)) setRateState(saved);
  }, []);
  const setRate = useCallback((r: number) => {
    setRateState(r);
    localStorage.setItem('wnt:rate', String(r));
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [track]);

  const seekTo = useCallback((s: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(s, el.duration || s));
  }, []);
  const seekBy = useCallback((s: number) => {
    const el = audioRef.current;
    if (el) seekTo(el.currentTime + s);
  }, [seekTo]);

  // Audio olayları + periyodik ilerleme kaydı.
  useEffect(() => {
    const el = audio();
    const onTime = () => setPosition(el.currentTime);
    const onDur = () => setDuration(el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); if (track) saveProgress(track.chapterId, el.currentTime, el.duration || 0); };
    const onEnded = () => {
      setPlaying(false);
      if (track) saveProgress(track.chapterId, el.duration || el.currentTime, el.duration || 0);
      next();
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    const tick = setInterval(() => { if (track && !el.paused) saveProgress(track.chapterId, el.currentTime, el.duration || 0); }, 5000);
    const onHide = () => { if (document.visibilityState === 'hidden' && track) saveProgress(track.chapterId, el.currentTime, el.duration || 0); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [track, next, saveProgress]);

  // MediaSession: kilit ekranı metadata + kontroller.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.seriesTitle, album: 'webnovel-tts',
      artwork: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', toggle);
    ms.setActionHandler('pause', toggle);
    ms.setActionHandler('seekbackward', () => seekBy(-15));
    ms.setActionHandler('seekforward', () => seekBy(30));
    ms.setActionHandler('previoustrack', hasPrev ? prev : null);
    ms.setActionHandler('nexttrack', hasNext ? next : null);
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime); });
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'] as MediaSessionAction[])
        ms.setActionHandler(a, null);
    };
  }, [track, toggle, seekBy, seekTo, next, prev, hasNext, hasPrev]);

  useEffect(() => {
    if ('mediaSession' in navigator && duration > 0)
      navigator.mediaSession.setPositionState?.({ duration, position: Math.min(position, duration), playbackRate: rate });
  }, [position, duration, rate]);

  return (
    <Ctx.Provider value={{ track, playing, position, duration, rate, playChapter, toggle, seekBy, seekTo, setRate, next, prev, hasNext, hasPrev }}>
      {children}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 3: Icon.tsx'e yeni ikonlar** — `IconName` union'a `| 'pause' | 'next' | 'back15' | 'fwd30' | 'download' | 'check' | 'headphones'`; `paths`'e:

```tsx
  pause: <path d="M5 3v10M11 3v10" strokeWidth="2.4" />,
  next: <><path d="M4 3.5 10 8l-6 4.5z" fill="currentColor" stroke="none" /><path d="M12 3.5v9" strokeWidth="2" /></>,
  back15: <><path d="M8 2.8A5.2 5.2 0 1 1 2.8 8" /><path d="M8 0.8 5.4 2.8 8 4.8" fill="currentColor" stroke="none" /><text x="8.2" y="11" fontSize="6.2" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="inherit">15</text></>,
  fwd30: <><path d="M8 2.8A5.2 5.2 0 1 0 13.2 8" /><path d="M8 0.8 10.6 2.8 8 4.8" fill="currentColor" stroke="none" /><text x="7.8" y="11" fontSize="6.2" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="inherit">30</text></>,
  download: <><path d="M8 2.5v7M4.8 6.5 8 9.7l3.2-3.2" /><path d="M2.8 12.5h10.4" /></>,
  check: <path d="M2.8 8.6 6.4 12 13.2 4.4" />,
  headphones: <><path d="M2.5 9.5a5.5 5.5 0 0 1 11 0" /><rect x="1.8" y="9" width="3" height="4.5" rx="1.2" /><rect x="11.2" y="9" width="3" height="4.5" rx="1.2" /></>,
```

- [ ] **Step 4: `lib/ui/player/PlayerBar.tsx` yaz:**

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { Icon } from '../Icon';
import { RATES, usePlayer } from './PlayerProvider';

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function PlayerBar() {
  const pathname = usePathname();
  const { track, playing, position, duration, rate, toggle, seekBy, seekTo, setRate, next, hasNext } = usePlayer();
  if (!track || pathname === '/login') return null;

  return (
    <div className="playerbar" role="region" aria-label="Oynatıcı">
      <div className="pb-info">
        <span className="t">{track.title}</span>
        <span className="muted">{track.seriesTitle}</span>
      </div>
      <div className="pb-controls">
        <button className="icon" onClick={() => seekBy(-15)} aria-label="15 saniye geri"><Icon name="back15" size={20} /></button>
        <button className="icon pb-play" onClick={toggle} aria-label={playing ? 'Duraklat' : 'Çal'}>
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        <button className="icon" onClick={() => seekBy(30)} aria-label="30 saniye ileri"><Icon name="fwd30" size={20} /></button>
        <button className="icon" onClick={next} disabled={!hasNext} aria-label="Sonraki bölüm"><Icon name="next" size={18} /></button>
      </div>
      <div className="pb-seek">
        <span className="mono muted">{fmt(position)}</span>
        <input
          type="range" min={0} max={Math.max(duration, 1)} step={1} value={Math.min(position, duration || position)}
          onChange={(e) => seekTo(Number(e.target.value))} aria-label="İlerleme"
        />
        <span className="mono muted">{fmt(duration)}</span>
      </div>
      <select className="pb-rate" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Oynatma hızı">
        {RATES.map((r) => <option key={r} value={r}>{r}x</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 5: globals.css'e oynatıcı stilleri ekle** (dosya sonuna):

```css
/* Global oynatıcı çubuğu */
.playerbar {
  position: fixed; inset: auto 0 0 0; z-index: 40;
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: 0.55rem 1rem;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--border);
}
.playerbar .pb-info { display: flex; flex-direction: column; min-width: 8rem; max-width: 16rem; overflow: hidden; }
.playerbar .pb-info .t { font-weight: 600; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.playerbar .pb-controls { display: flex; align-items: center; gap: 0.35rem; }
.playerbar .pb-play { width: 2.4rem; height: 2.4rem; background: var(--accent); color: var(--accent-fg); border-radius: 999px; }
.playerbar .pb-play:hover { background: var(--accent-hover); }
.playerbar .pb-seek { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 10rem; }
.playerbar .pb-seek input[type='range'] { flex: 1; accent-color: var(--accent); }
.playerbar .pb-rate { width: auto; padding: 0.25rem 0.4rem; }
body:has(.playerbar) .container { padding-bottom: 5.5rem; }
@media (max-width: 640px) {
  .playerbar { gap: 0.5rem; }
  .playerbar .pb-info { max-width: 10rem; }
}
```

- [ ] **Step 6: layout bağla** — `app/layout.tsx` gövdesi:

```tsx
      <body>
        <RegisterSw />
        <PlayerProvider>
          <header className="topbar">…(mevcut içerik aynen)…</header>
          <div className="shell">
            <Sidebar />
            <main className="container">{children}</main>
          </div>
          <PlayerBar />
        </PlayerProvider>
      </body>
```

(import'lar: `PlayerProvider`, `PlayerBar` — `@/lib/ui/player/...`; RegisterSw Task 3'te eklendi.)

- [ ] **Step 7: Doğrula** — `npx tsc --noEmit` temiz, `npm run build` temiz, `npm test` yeşil (değişmemeli).

- [ ] **Step 8: Commit** — `feat(panel): global oynatıcı — PlayerProvider/PlayerBar, MediaSession, hız/atlama, indirme yardımcıları`

---

### Task 5: /library sayfası + sidebar bağlantısı

**Files:**
- Create: `app/library/page.tsx`
- Modify: `lib/ui/Sidebar.tsx` (Kütüphane bağlantısı — Ayarlar'ın üstüne)

**Interfaces:**
- Consumes: `GET /api/library` (Task 2), `usePlayer`/`PlayerTrack` (Task 4), `offline.ts` yardımcıları (Task 4), `Icon` yeni adları (Task 4).

- [ ] **Step 1: `app/library/page.tsx` yaz** (tamamı):

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';
import { usePlayer, type PlayerTrack } from '@/lib/ui/player/PlayerProvider';
import { audioUrl, downloadChapter, downloadedSet, removeDownload, storageEstimateText } from '@/lib/ui/player/offline';

type LibChapter = { id: string; title: string; position: number; status: string; renderPath: string | null; durationSec: number | null; progressSec: number | null; progressUpdatedAt: number };
type LibSeries = { project: { id: string; title: string }; chapters: LibChapter[] };

function fmt(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const toTrack = (seriesTitle: string, c: LibChapter): PlayerTrack => ({
  chapterId: c.id, title: c.title, seriesTitle,
  src: audioUrl(c.renderPath!), durationSec: c.durationSec, progressSec: c.progressSec,
});

export default function LibraryPage() {
  const [lib, setLib] = useState<LibSeries[] | null>(null);
  const [err, setErr] = useState('');
  const [dl, setDl] = useState<Set<string>>(new Set());
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const { track, playing, playChapter, toggle } = usePlayer();

  // Offline'dayken yalnız indirilenler oynatılabilir işaretlenir (spec §5).
  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/library');
      if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Kütüphane yüklenemedi'); setLib([]); return; }
      setLib(await res.json());
    } catch { setErr('Bağlantı yok — indirilenler dışında içerik kullanılamaz'); setLib([]); }
    setDl(await downloadedSet());
    setSpace(await storageEstimateText());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleDownload(c: LibChapter) {
    if (!c.renderPath) return;
    setDlBusy(c.id); setErr('');
    try {
      if (dl.has(c.renderPath)) await removeDownload(c.renderPath);
      else if (!(await downloadChapter(c.renderPath))) setErr('İndirilemedi — bağlantıyı kontrol et');
      setDl(await downloadedSet());
      setSpace(await storageEstimateText());
    } finally { setDlBusy(null); }
  }

  if (lib === null) return <p className="muted">Yükleniyor…</p>;

  // "Devam et": en son dinlenen, bitmemiş bölüm.
  const all = lib.flatMap((s) => s.chapters.filter((c) => c.renderPath).map((c) => ({ s, c })));
  const cont = all
    .filter(({ c }) => c.progressSec != null && c.durationSec != null && c.progressSec < c.durationSec - 5)
    .sort((a, b) => b.c.progressUpdatedAt - a.c.progressUpdatedAt)[0];
  const queueOf = (s: LibSeries) => s.chapters.filter((c) => c.renderPath).map((c) => toTrack(s.project.title, c));

  return (
    <>
      <div className="crumbs"><span className="here">Kütüphane</span></div>
      <h1>Kütüphane {space && <span className="muted" style={{ fontSize: '0.8rem' }}>indirilenler: {space}</span>}</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      {cont && (
        <div className="card continue">
          <h2><Icon name="headphones" /> Devam et</h2>
          <p className="row">
            <button onClick={() => playChapter(toTrack(cont.s.project.title, cont.c), queueOf(cont.s))}>
              <Icon name="play" /> {cont.c.title}
            </button>
            <span className="muted">{cont.s.project.title} · {fmt(cont.c.progressSec)} / {fmt(cont.c.durationSec)}</span>
          </p>
        </div>
      )}

      {lib.length === 0 && !err && (
        <EmptyState icon="headphones" title="Henüz dinlenecek bölüm yok">Bir bölümü üretip birleştirdiğinde burada görünür.</EmptyState>
      )}

      {lib.map((s) => (
        <div key={s.project.id} className="card">
          <h2><Icon name="folder" /> {s.project.title}</h2>
          <div className="rows">
            {s.chapters.map((c) => {
              const playable = !!c.renderPath && (!offline || dl.has(c.renderPath));
              const isCurrent = track?.chapterId === c.id;
              const pct = c.progressSec != null && c.durationSec ? Math.min(100, Math.round((c.progressSec / c.durationSec) * 100)) : null;
              return (
                <div key={c.id} className={playable ? 'rowitem' : 'rowitem muted'}>
                  <span className="pos mono">{c.position}</span>
                  {playable ? (
                    <button className="icon" onClick={() => (isCurrent ? toggle() : playChapter(toTrack(s.project.title, c), queueOf(s)))}
                      aria-label={isCurrent && playing ? 'Duraklat' : 'Çal'}>
                      <Icon name={isCurrent && playing ? 'pause' : 'play'} size={15} />
                    </button>
                  ) : (
                    <span title={c.status === 'voiced' ? 'Önce Birleştir' : 'Çevrimdışı — indirilmedi'}><Icon name="warn" size={13} /></span>
                  )}
                  <span className="t">{c.title}</span>
                  {playable ? (
                    <>
                      <span className="muted mono">{pct != null ? `%${pct}` : ''} {fmt(c.durationSec)}</span>
                      <button className="icon" onClick={() => toggleDownload(c)} disabled={dlBusy !== null}
                        aria-label={dl.has(c.renderPath!) ? 'İndirileni sil' : 'Offline için indir'}
                        title={dl.has(c.renderPath!) ? 'İndirildi — silmek için tıkla' : 'Offline için indir'}>
                        {dlBusy === c.id ? <Icon name="spinner" size={14} /> : <Icon name={dl.has(c.renderPath!) ? 'check' : 'download'} size={14} />}
                      </button>
                    </>
                  ) : c.status === 'voiced' ? (
                    <Link className="muted" href={`/chapters/${c.id}`}>Birleştir bekliyor →</Link>
                  ) : (
                    <span className="muted">çevrimdışı — indirilmedi</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Sidebar'a Kütüphane bağlantısı** — `lib/ui/Sidebar.tsx` alt bölümündeki blokta "Yeni proje" satırının ÜSTÜNE ekle:

```tsx
              <Link href="/library" className={pathname === '/library' ? 'side-item manage on' : 'side-item manage'}>
                <Icon name="headphones" size={12} /> Kütüphane
              </Link>
```

- [ ] **Step 3: Doğrula** — `npx tsc --noEmit`, `npm run build`, `npm test` (yeşil kalır).

- [ ] **Step 4: Commit** — `feat(panel): kütüphane sayfası — devam et, seri listesi, indir/sil, sidebar bağlantısı`

---

### Task 6: Docs + manuel doğrulama listesi

**Files:**
- Modify: `CLAUDE.md` (Dilim D ✅; "Sonraki oturum" → backlog; PWA notları)
- Modify: `README.md` (Durum listesi D ✅; "Dinleme (PWA)" bölümü)

- [ ] **Step 1: CLAUDE.md güncelle:**
  - "Ne yapıldı" listesinde Dilim D satırını ✅ yap: `✅ **Dilim D — Kütüphane + PWA oynatıcı** (spec: docs/superpowers/specs/2026-07-19-panel-slice-d-library-pwa-player-design.md, plan: docs/superpowers/plans/2026-07-19-panel-slice-d-library-pwa-player.md): /library sayfası (devam et + seri listesi + indir/sil), listening_progress ile DB resume, global alt çubuk oynatıcı (MediaSession, 0.75-2x hız, ±15/30 sn, otomatik sonraki), manifest + SVG ikon + elle yazılmış sw.js (audio cache-first + Range→206, offline kütüphane kabuğu), middleware PUBLIC: manifest/sw/icons.`
  - "Sonraki oturum için öneri"yi backlog'a çevir: `Ana dilimler tamam (A→D). Backlog adayları: VPS'e kurulum + HTTPS (PWA için şart), Gemini faturalama kararı / Chirp adapter'ı, cache & renders GC, ses önizleme düğmesi, uyku zamanlayıcısı, PNG manifest ikonları (eski Android), stitchLatest hata metni cilası. Kullanıcıyla önceliklendirin.`
- [ ] **Step 2: README güncelle:** Durum listesine D ✅; yeni "## Dinleme (PWA)" bölümü: telefonda kurulum (Chrome → Ana ekrana ekle; HTTPS veya localhost gerekir), kütüphane/devam et, indir → uçak modunda dinleme, hız/atlama/kilit ekranı kontrolleri; iOS kısıt notu (arka plan çalma sınırlı olabilir — Android birincil).
- [ ] **Step 3: Manuel doğrulama listesi** (kullanıcı görsel onayına sunulacak; README'ye DEĞİL — dilim sonu raporuna): (1) `npm run build && npm start` (SW yalnız production'da) → Chrome'da kurulum önerisi; (2) kilit ekranı: başlık/seri + çal-duraklat + ±15/30 + sonraki; (3) hız değişimi kalıcı; (4) bölüm sonunda otomatik sonraki; (5) resume: duraklat → sayfayı yenile → kaldığı yerden; (6) İndir → uçak modu → /library açılır, indirilen çalar, seek çalışır; (7) Sil → alan düşer.
- [ ] **Step 4: Doğrula** — `npm run build` + `npm test`.
- [ ] **Step 5: Commit** — `docs: Dilim D — README dinleme bölümü, CLAUDE.md durum + backlog`

---

## Doğrulama (dilim sonu)

1. Tam suite (~36 dosya / ~200 test) + tsc + build temiz.
2. Kullanıcı manuel doğrulaması (Task 6 Step 3 listesi) — özellikle offline çalma + seek (sw.js Range dilimleme) ve kilit ekranı kontrolleri.
3. Not: SW yalnız production build'de kayıt olur — görsel test `npm run build && npm start` ile yapılır (dev'de PWA özellikleri kapalı).
