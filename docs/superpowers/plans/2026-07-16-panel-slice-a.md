# Panel Dilim A (İskelet + Veri Katmanı + Dikey Dilim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-host web paneli: proje/bölüm CRUD + elle JSON script yapıştır → mevcut `src/core` orkestratörüyle mp3 üret → SSE ilerleme → tarayıcıda dinle.

**Architecture:** Next.js (App Router) repo kökünde; SQLite (Drizzle + better-sqlite3) + yerel disk (`./data`); tek-sahip auth (env şifresi → HMAC-imzalı cookie, edge middleware). İş mantığı `lib/services/` içinde saf fonksiyonlar (test edilebilir), API rotaları ince sarmalayıcı. Mevcut `src/core` hiç değişmeden import edilir.

**Tech Stack:** Next.js 15, React 19, TypeScript (strict, ESM), Drizzle ORM + better-sqlite3, zod (mevcut), vitest, mevcut `src/core` (Gemini/Mock TTS adapter, ffmpeg stitch).

**Spec:** `docs/superpowers/specs/2026-07-16-panel-slice-a-design.md`

## Global Constraints

- Node **>=20** (package.json `engines` mevcut; değiştirme).
- Paket `"type": "module"` (ESM) — kalacak.
- Kullanıcıya görünen tüm metinler ve hata mesajları **Türkçe** (mevcut CLI stiliyle tutarlı).
- Kod stili: mevcut `src/core` gibi **kompakt** (kısa dosyalar, gereksiz soyutlama yok, Türkçe yorumlar).
- Repo public olacak: **hiçbir sır/anahtar commit edilmez**; `.env` git-ignore'da, `./data/` git-ignore'a eklenecek (Task 11).
- Testler ağa çıkmaz: TTS için daima `MockAdapter` (`src/core/tts/mock.ts`).
- Mevcut 23 çekirdek test **her task sonunda yeşil kalmalı** (`npm test`).
- `src/core/**` bu dilimde **değiştirilmez** (yalnızca import edilir).
- Relative import kuralı: `src/core` içi importlar `.js` uzantılı (mevcut); yeni `lib/`/`app/` kodu `@/` alias'ı kullanır (`@/lib/...`, `@/src/core/schema` — uzantısız).

---

### Task 1: Next.js iskeleti + yapılandırma

Next 15 + React 19 kurulur, tsconfig/vitest alias eklenir, boş bir ana sayfa ile `next build` doğrulanır. Mevcut testler yeşil kalır.

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Create: `next.config.ts`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx` (geçici placeholder; Task 10'da gerçek sayfa gelecek)

**Interfaces:**
- Consumes: —
- Produces: `@/*` path alias'ı (tsconfig + vitest) → sonraki tüm task'lar `@/lib/...` importu kullanır; `npm run dev|build|start` script'leri.

- [ ] **Step 1: Bağımlılıkları kur**

```bash
npm install next@^15 react@^19 react-dom@^19 drizzle-orm@^0.44 better-sqlite3@^12
npm install -D drizzle-kit@^0.31 @types/better-sqlite3 @types/react @types/react-dom
```

Beklenen: `package.json` dependencies güncellenir, hata yok.

- [ ] **Step 2: package.json script'lerini güncelle**

`scripts` bloğu şu hale gelsin (mevcut `test` ve `generate` korunur):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "generate": "tsx src/cli/generate.ts",
  "db:generate": "drizzle-kit generate"
}
```

- [ ] **Step 3: tsconfig.json'u Next + alias için güncelle**

Dosyanın tamamını şununla değiştir:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "app", "lib", "middleware.ts", "src", "tests", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Not: `types: ["node"]` kaldırıldı (DOM + react tipleri gerekli; @types/node yine otomatik dahil).

- [ ] **Step 4: vitest.config.ts'e alias ekle**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 5: next.config.ts oluştur**

```ts
import type { NextConfig } from 'next';

// Native/binary paketler bundle edilmesin (better-sqlite3 .node dosyası, ffmpeg-static binary yolu)
const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'ffmpeg-static'],
};
export default nextConfig;
```

- [ ] **Step 6: app/layout.tsx + app/globals.css + placeholder app/page.tsx oluştur**

`app/layout.tsx`:

```tsx
import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = { title: 'webnovel-tts panel' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <header className="topbar"><Link href="/">📚 webnovel-tts</Link></header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
```

`app/globals.css`:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #14151a; color: #e8e8ea; }
a { color: #7db4ff; text-decoration: none; }
.topbar { padding: 0.7rem 1.2rem; border-bottom: 1px solid #2a2c33; font-weight: 600; }
.container { max-width: 60rem; margin: 0 auto; padding: 1.2rem; }
h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; }
input, textarea, select { width: 100%; padding: 0.45rem; border: 1px solid #3a3d46; border-radius: 6px; background: #1d1f26; color: inherit; font: inherit; }
textarea { min-height: 8rem; font-family: ui-monospace, monospace; font-size: 0.85rem; }
button { padding: 0.45rem 0.9rem; border: 0; border-radius: 6px; background: #3b82f6; color: #fff; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.danger { background: #b33; } button.ghost { background: #2a2c33; }
.card { border: 1px solid #2a2c33; border-radius: 8px; padding: 0.9rem; margin: 0.6rem 0; background: #191b21; }
.row { display: flex; gap: 0.6rem; align-items: center; }
.muted { color: #9a9ca6; font-size: 0.85rem; }
.err { color: #f88; white-space: pre-wrap; font-size: 0.85rem; }
.badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; background: #2a2c33; }
.badge.done { background: #14532d; } .badge.error, .badge.failed { background: #7f1d1d; } .badge.generating { background: #1e3a8a; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
td, th { padding: 0.35rem 0.5rem; border-bottom: 1px solid #2a2c33; text-align: left; }
progress { width: 100%; }
```

`app/page.tsx` (geçici — Task 10'da değişecek):

```tsx
export default function Home() {
  return <h1>webnovel-tts panel — kurulum tamam</h1>;
}
```

- [ ] **Step 7: Build + mevcut testleri doğrula**

Çalıştır: `npm run build`
Beklenen: build başarılı ("Compiled successfully"). İlk çalıştırmada Next `next-env.d.ts` üretir — bu dosya commit edilecek.

Çalıştır: `npm test`
Beklenen: mevcut 23 test PASS (panel testi henüz yok).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts next.config.ts app/ next-env.d.ts
git commit -m "feat(panel): Next.js 15 iskeleti + yapılandırma (Dilim A başlangıç)"
```

---

### Task 2: Config + id yardımcıları

**Files:**
- Create: `lib/config.ts`
- Create: `lib/id.ts`
- Test: `tests/panel/config.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `dataDir(): string`, `dbPath(): string`, `audioDir(): string` — env (`DATA_DIR`, `DB_PATH`) veya varsayılan `./data`; **fonksiyon** (test'te env değişimi etkili olsun diye lazy).
  - `newId(prefix: string): string` — `prj_a1b2c3d4e5f6` biçimi.

- [ ] **Step 1: Failing test yaz**

`tests/panel/config.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { audioDir, dataDir, dbPath } from '@/lib/config';
import { newId } from '@/lib/id';

describe('config', () => {
  afterEach(() => { delete process.env.DATA_DIR; delete process.env.DB_PATH; });

  test('varsayılan: ./data altı', () => {
    expect(dataDir()).toBe(join(process.cwd(), 'data'));
    expect(dbPath()).toBe(join(dataDir(), 'app.db'));
    expect(audioDir()).toBe(join(dataDir(), 'audio'));
  });

  test('DATA_DIR env ile değişir (lazy)', () => {
    process.env.DATA_DIR = join('C:', 'tmp', 'wnt');
    expect(dataDir()).toBe(join('C:', 'tmp', 'wnt'));
    expect(audioDir()).toBe(join('C:', 'tmp', 'wnt', 'audio'));
  });
});

describe('newId', () => {
  test('önek + 12 hex, benzersiz', () => {
    const a = newId('prj'), b = newId('prj');
    expect(a).toMatch(/^prj_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/config.test.ts`
Beklenen: FAIL — `Cannot find module '@/lib/config'` (veya benzeri çözümleme hatası).

- [ ] **Step 3: Implementasyon**

`lib/config.ts`:

```ts
import { join } from 'node:path';

// Lazy fonksiyonlar: testler process.env'i çalışma anında değiştirebilsin.
export function dataDir(): string { return process.env.DATA_DIR ?? join(process.cwd(), 'data'); }
export function dbPath(): string { return process.env.DB_PATH ?? join(dataDir(), 'app.db'); }
export function audioDir(): string { return join(dataDir(), 'audio'); }
```

`lib/id.ts`:

```ts
import { randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/config.test.ts`
Beklenen: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts lib/id.ts tests/panel/config.test.ts
git commit -m "feat(panel): config (data yolları) + id üretimi"
```

---

### Task 3: DB şeması + migrasyon + istemci

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `drizzle.config.ts`
- Create: `drizzle/` (drizzle-kit generate çıktısı — commit edilir)
- Test: `tests/panel/db.test.ts`

**Interfaces:**
- Consumes: `dbPath()` (Task 2).
- Produces:
  - Drizzle tabloları: `settings, projects, chapters, scripts, segments, renders` (spec §4 şeması; kolonlar aşağıda).
  - `type Db` — drizzle better-sqlite3 instance tipi.
  - `createDb(path?: string): Db` — dosya ya da `':memory:'`; FK pragma açık; migrasyonları uygular.
  - `getDb(): Db` — süreç-tekil (singleton); `setDbForTests(db: Db): void` — handler testleri için override.

- [ ] **Step 1: Şemayı yaz**

`lib/db/schema.ts`:

```ts
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Gizli-olmayan varsayılanlar: provider, model, single_voice, default_voice
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  rawText: text('raw_text').notNull().default(''),
  narrationStyle: text('narration_style'),
  status: text('status').notNull().default('draft'), // draft|scripted|generating|done|error
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  source: text('source').notNull(), // manual|llm (Dilim A: manual)
  json: text('json').notNull(),     // doğrulanmış VoiceoverScript JSON metni
  createdAt: integer('created_at').notNull(),
});

export const segments = sqliteTable('segments', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  speaker: text('speaker').notNull(),
  style: text('style'),
  text: text('text').notNull(),
  voice: text('voice').notNull(),
  status: text('status').notNull().default('pending'), // pending|done|failed
  audioPath: text('audio_path'), // Dilim A'da NULL; segment-başı dosya Dilim C
  error: text('error'),
  contentHash: text('content_hash'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const renders = sqliteTable('renders', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  path: text('path').notNull(), // audioDir()'e GÖRELİ yol: "<chapterId>/<renderId>.mp3"
  durationSec: real('duration_sec'),
  createdAt: integer('created_at').notNull(),
});
```

- [ ] **Step 2: drizzle.config.ts + migrasyon üret**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './lib/db/schema.ts',
  out: './drizzle',
});
```

Çalıştır: `npm run db:generate`
Beklenen: `drizzle/0000_*.sql` + `drizzle/meta/` oluşur (6 tablo içeren CREATE TABLE'lar). Bu klasör commit edilir.

- [ ] **Step 3: Failing test yaz**

`tests/panel/db.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/lib/db/client';
import { chapters, projects, segments, scripts } from '@/lib/db/schema';

function mkProject(db: ReturnType<typeof createDb>, id = 'prj_x') {
  db.insert(projects).values({ id, title: 'T', createdAt: 1, updatedAt: 1 }).run();
  return id;
}

describe('db client + şema', () => {
  test(':memory: db açılır, tablolar migrate edilir', () => {
    const db = createDb(':memory:');
    expect(db.select().from(projects).all()).toEqual([]);
  });

  test('cascade: proje silinince bölüm+script+segment silinir', () => {
    const db = createDb(':memory:');
    const pid = mkProject(db);
    db.insert(chapters).values({ id: 'chp_x', projectId: pid, position: 1, title: 'B1', createdAt: 1, updatedAt: 1 }).run();
    db.insert(scripts).values({ id: 'scr_x', chapterId: 'chp_x', version: 1, source: 'manual', json: '{}', createdAt: 1 }).run();
    db.insert(segments).values({ id: 'seg_x', chapterId: 'chp_x', scriptId: 'scr_x', idx: 0, speaker: 'n', text: 't', voice: 'gemini:Charon', createdAt: 1, updatedAt: 1 }).run();

    db.delete(projects).where(eq(projects.id, pid)).run();
    expect(db.select().from(chapters).all()).toEqual([]);
    expect(db.select().from(scripts).all()).toEqual([]);
    expect(db.select().from(segments).all()).toEqual([]);
  });

  test('FK ihlali reddedilir (foreign_keys pragma açık)', () => {
    const db = createDb(':memory:');
    expect(() =>
      db.insert(chapters).values({ id: 'chp_y', projectId: 'yok', position: 1, title: 'B', createdAt: 1, updatedAt: 1 }).run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
```

- [ ] **Step 4: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/db.test.ts`
Beklenen: FAIL — `Cannot find module '@/lib/db/client'`.

- [ ] **Step 5: İstemciyi yaz**

`lib/db/client.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema';
import { dbPath } from '../config';

export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(path = dbPath()): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
  return db;
}

let _db: Db | undefined;
export function getDb(): Db { return (_db ??= createDb()); }
export function setDbForTests(db: Db): void { _db = db; } // handler testleri için
```

- [ ] **Step 6: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/db.test.ts`
Beklenen: PASS (3 test).

- [ ] **Step 7: Commit**

```bash
git add lib/db/ drizzle.config.ts drizzle/ tests/panel/db.test.ts
git commit -m "feat(panel): SQLite şema (Drizzle) + migrasyon + istemci"
```

---

### Task 4: Servisler — settings, projects, chapters

**Files:**
- Create: `lib/services/settings.ts`
- Create: `lib/services/projects.ts`
- Create: `lib/services/chapters.ts`
- Test: `tests/panel/services-crud.test.ts`

**Interfaces:**
- Consumes: `Db`, tablolar (Task 3); `newId` (Task 2).
- Produces (sonraki task'lar ve API rotaları bunları kullanır):
  - `getSetting(db: Db, key: string): string | undefined`; `setSetting(db: Db, key: string, value: string): void`
  - `type Project = typeof projects.$inferSelect` (ve `Chapter` benzer)
  - `createProject(db, input: { title: string; description?: string }): Project`
  - `listProjects(db): Project[]`; `getProject(db, id): Project | undefined`
  - `updateProject(db, id, patch: { title?: string; description?: string }): Project | undefined`
  - `deleteProject(db, id): void`
  - `createChapter(db, projectId, input: { title: string }): Chapter` (position = max+1, status 'draft')
  - `listChapters(db, projectId): Chapter[]` (position sıralı); `getChapter(db, id): Chapter | undefined`
  - `updateChapter(db, id, patch: { title?; rawText?; narrationStyle?; position?; status? }): Chapter | undefined`
  - `deleteChapter(db, id): void`

- [ ] **Step 1: Failing test yaz**

`tests/panel/services-crud.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { getSetting, setSetting } from '@/lib/services/settings';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '@/lib/services/projects';
import { createChapter, deleteChapter, getChapter, listChapters, updateChapter } from '@/lib/services/chapters';

describe('settings', () => {
  test('set/get + üzerine yazma', () => {
    const db = createDb(':memory:');
    expect(getSetting(db, 'provider')).toBeUndefined();
    setSetting(db, 'provider', 'mock');
    expect(getSetting(db, 'provider')).toBe('mock');
    setSetting(db, 'provider', 'gemini');
    expect(getSetting(db, 'provider')).toBe('gemini');
  });
});

describe('projects', () => {
  test('CRUD döngüsü', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'Roman' });
    expect(p.id).toMatch(/^prj_/);
    expect(listProjects(db)).toHaveLength(1);
    const u = updateProject(db, p.id, { title: 'Roman 2' });
    expect(u?.title).toBe('Roman 2');
    expect(getProject(db, p.id)?.title).toBe('Roman 2');
    deleteProject(db, p.id);
    expect(listProjects(db)).toHaveLength(0);
  });
});

describe('chapters', () => {
  test('position otomatik artar, listede sıralı gelir', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c1 = createChapter(db, p.id, { title: 'Bölüm 1' });
    const c2 = createChapter(db, p.id, { title: 'Bölüm 2' });
    expect(c1.position).toBe(1);
    expect(c2.position).toBe(2);
    expect(c1.status).toBe('draft');
    expect(listChapters(db, p.id).map((c) => c.title)).toEqual(['Bölüm 1', 'Bölüm 2']);
  });

  test('update: rawText + narrationStyle + status', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    updateChapter(db, c.id, { rawText: 'metin', narrationStyle: 'sakin', status: 'scripted' });
    const g = getChapter(db, c.id);
    expect(g?.rawText).toBe('metin');
    expect(g?.narrationStyle).toBe('sakin');
    expect(g?.status).toBe('scripted');
    deleteChapter(db, c.id);
    expect(getChapter(db, c.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/services-crud.test.ts`
Beklenen: FAIL — modüller yok.

- [ ] **Step 3: Servisleri yaz**

`lib/services/settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
```

`lib/services/projects.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects } from '../db/schema';
import { newId } from '../id';

export type Project = typeof projects.$inferSelect;

export function createProject(db: Db, input: { title: string; description?: string }): Project {
  const now = Date.now();
  const row: Project = { id: newId('prj'), title: input.title, description: input.description ?? null, createdAt: now, updatedAt: now };
  db.insert(projects).values(row).run();
  return row;
}

export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(projects.createdAt).all();
}

export function getProject(db: Db, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function updateProject(db: Db, id: string, patch: { title?: string; description?: string }): Project | undefined {
  db.update(projects).set({ ...patch, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
  return getProject(db, id);
}

export function deleteProject(db: Db, id: string): void {
  db.delete(projects).where(eq(projects.id, id)).run();
}
```

`lib/services/chapters.ts`:

```ts
import { eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chapters } from '../db/schema';
import { newId } from '../id';

export type Chapter = typeof chapters.$inferSelect;
export type ChapterPatch = { title?: string; rawText?: string; narrationStyle?: string | null; position?: number; status?: string };

export function createChapter(db: Db, projectId: string, input: { title: string }): Chapter {
  const now = Date.now();
  const m = db.select({ m: max(chapters.position) }).from(chapters).where(eq(chapters.projectId, projectId)).get();
  const row: Chapter = {
    id: newId('chp'), projectId, position: (m?.m ?? 0) + 1, title: input.title,
    rawText: '', narrationStyle: null, status: 'draft', createdAt: now, updatedAt: now,
  };
  db.insert(chapters).values(row).run();
  return row;
}

export function listChapters(db: Db, projectId: string): Chapter[] {
  return db.select().from(chapters).where(eq(chapters.projectId, projectId)).orderBy(chapters.position).all();
}

export function getChapter(db: Db, id: string): Chapter | undefined {
  return db.select().from(chapters).where(eq(chapters.id, id)).get();
}

export function updateChapter(db: Db, id: string, patch: ChapterPatch): Chapter | undefined {
  db.update(chapters).set({ ...patch, updatedAt: Date.now() }).where(eq(chapters.id, id)).run();
  return getChapter(db, id);
}

export function deleteChapter(db: Db, id: string): void {
  db.delete(chapters).where(eq(chapters.id, id)).run();
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/services-crud.test.ts`
Beklenen: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add lib/services/settings.ts lib/services/projects.ts lib/services/chapters.ts tests/panel/services-crud.test.ts
git commit -m "feat(panel): settings/projects/chapters servisleri"
```

---

### Task 5: Script import servisi

Elle yapıştırılan JSON script'i zod ile doğrular, versiyonlu `scripts` satırı + `segments` satırları yazar, bölüm durumunu `scripted` yapar.

**Files:**
- Create: `lib/services/scripts.ts`
- Test: `tests/panel/scripts.test.ts`

**Interfaces:**
- Consumes: `parseScript` (`@/src/core/schema`), `validateSpeakers`, `resolveVoiceForSpeaker` (`@/src/core/voices`), Task 3-4 üretimleri.
- Produces:
  - `type ScriptRow = typeof scripts.$inferSelect`; `type SegmentRow = typeof segments.$inferSelect`
  - `importScript(db: Db, chapterId: string, jsonText: string): { scriptId: string; version: number; segmentCount: number }` — geçersiz JSON'da `SyntaxError`, şema hatasında `ZodError`, bilinmeyen konuşmacıda `Error` fırlatır (hiçbir satır yazılmaz).
  - `latestScript(db: Db, chapterId: string): ScriptRow | undefined`
  - `listSegments(db: Db, scriptId: string): SegmentRow[]` (idx sıralı)

- [ ] **Step 1: Failing test yaz**

`tests/panel/scripts.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  return { db, chapterId: c.id };
}

describe('importScript', () => {
  test('geçerli script: satırlar yazılır, status scripted', () => {
    const { db, chapterId } = setup();
    const r = importScript(db, chapterId, FIXTURE);
    expect(r.version).toBe(1);
    expect(r.segmentCount).toBe(5);
    const scr = latestScript(db, chapterId)!;
    expect(scr.id).toBe(r.scriptId);
    expect(scr.source).toBe('manual');
    const segs = listSegments(db, scr.id);
    expect(segs).toHaveLength(5);
    expect(segs[0]).toMatchObject({ idx: 0, speaker: 'narrator', voice: 'gemini:Charon', status: 'pending' });
    expect(getChapter(db, chapterId)?.status).toBe('scripted');
  });

  test('tekrar import: versiyon artar, latestScript yenisini döner', () => {
    const { db, chapterId } = setup();
    importScript(db, chapterId, FIXTURE);
    const r2 = importScript(db, chapterId, FIXTURE);
    expect(r2.version).toBe(2);
    expect(latestScript(db, chapterId)?.version).toBe(2);
  });

  test('bozuk JSON: SyntaxError, hiçbir şey yazılmaz', () => {
    const { db, chapterId } = setup();
    expect(() => importScript(db, chapterId, '{bozuk')).toThrow(SyntaxError);
    expect(latestScript(db, chapterId)).toBeUndefined();
  });

  test('şema hatası: ZodError', () => {
    const { db, chapterId } = setup();
    expect(() => importScript(db, chapterId, JSON.stringify({ schema_version: '1.0' }))).toThrow(/segments|cast|Required/i);
  });

  test('cast dışı konuşmacı: anlaşılır hata', () => {
    const { db, chapterId } = setup();
    const bad = JSON.parse(FIXTURE);
    bad.segments[0].speaker = 'hayalet';
    expect(() => importScript(db, chapterId, JSON.stringify(bad))).toThrow(/bilinmeyen konuşmacı/);
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/scripts.test.ts`
Beklenen: FAIL — `lib/services/scripts` yok.

- [ ] **Step 3: Servisi yaz**

`lib/services/scripts.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { scripts, segments } from '../db/schema';
import { newId } from '../id';
import { updateChapter } from './chapters';
import { parseScript } from '@/src/core/schema';
import { resolveVoiceForSpeaker, validateSpeakers } from '@/src/core/voices';

export type ScriptRow = typeof scripts.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;

// Elle yapıştırılan JSON script'i doğrular ve versiyonlu olarak kaydeder.
// Geçersiz girişte fırlatır (SyntaxError | ZodError | Error) — hiçbir satır yazılmaz.
export function importScript(db: Db, chapterId: string, jsonText: string): { scriptId: string; version: number; segmentCount: number } {
  const parsed = parseScript(JSON.parse(jsonText));
  validateSpeakers(parsed); // bilinmeyen konuşmacı varsa erken ve anlaşılır hata

  const last = db.select({ v: scripts.version }).from(scripts)
    .where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
  const version = (last?.v ?? 0) + 1;
  const scriptId = newId('scr');
  const now = Date.now();

  db.insert(scripts).values({ id: scriptId, chapterId, version, source: 'manual', json: jsonText, createdAt: now }).run();
  db.insert(segments).values(parsed.segments.map((s, i) => ({
    id: newId('seg'), chapterId, scriptId, idx: i,
    speaker: s.speaker, style: s.style ?? null, text: s.text,
    voice: resolveVoiceForSpeaker(parsed, s.speaker).cast.voiceId,
    status: 'pending', createdAt: now, updatedAt: now,
  }))).run();
  updateChapter(db, chapterId, { status: 'scripted' });

  return { scriptId, version, segmentCount: parsed.segments.length };
}

export function latestScript(db: Db, chapterId: string): ScriptRow | undefined {
  return db.select().from(scripts).where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
}

export function listSegments(db: Db, scriptId: string): SegmentRow[] {
  return db.select().from(segments).where(eq(segments.scriptId, scriptId)).orderBy(segments.idx).all();
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/scripts.test.ts`
Beklenen: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add lib/services/scripts.ts tests/panel/scripts.test.ts
git commit -m "feat(panel): script import servisi (zod doğrulama + versiyonlama)"
```

---

### Task 6: Üretim (generation) servisi

En güncel script'i çekirdek orkestratörle üretir, mp3'ü diske yazar, `renders` + segment durumları + bölüm durumunu günceller.

**Files:**
- Create: `lib/services/generation.ts`
- Test: `tests/panel/generation.test.ts`

**Interfaces:**
- Consumes: `generateEpisode` (`@/src/core/orchestrator`), `overrideAllVoices` (`@/src/core/voices`), `parseScript`, `MockAdapter` (`@/src/core/tts/mock`), `GeminiAdapter` (`@/src/core/tts/gemini`), `TtsAdapter` (`@/src/core/types`), `latestScript`/`listSegments` (Task 5), `getSetting` (Task 4), `audioDir()` (Task 2).
- Produces:
  - `adapterFromSettings(db: Db): TtsAdapter` — `settings.provider` → env `TTS_PROVIDER` → `'gemini'`; gemini için `GEMINI_API_KEY` şart (yoksa Türkçe hata fırlatır); model: `settings.model` → env `TTS_MODEL`.
  - `interface GenerateOutcome { renderId: string; renderPath: string; segmentCount: number; failedCount: number; totalUsd: number }` (`renderPath` = audioDir'e göreli)
  - `generateChapter(db: Db, chapterId: string, adapter: TtsAdapter, onProgress?: (done: number, total: number) => void): Promise<GenerateOutcome>`
  - `listRenders(db: Db, chapterId: string): RenderRow[]` (yeni → eski)

- [ ] **Step 1: Failing test yaz**

`tests/panel/generation.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { adapterFromSettings, generateChapter, listRenders } from '@/lib/services/generation';
import { setSetting } from '@/lib/services/settings';
import { MockAdapter } from '@/src/core/tts/mock';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '@/src/core/types';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-gen-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}

describe('generateChapter (mock adapter)', () => {
  test('başarılı üretim: mp3 dosyası + renders satırı + tüm segmentler done + bölüm done', async () => {
    const { db, chapterId } = setup();
    const progress: [number, number][] = [];
    const out = await generateChapter(db, chapterId, new MockAdapter(), (d, t) => progress.push([d, t]));

    expect(out.segmentCount).toBe(5);
    expect(out.failedCount).toBe(0);
    expect(progress.at(-1)).toEqual([5, 5]);
    expect(existsSync(join(audioDir(), out.renderPath))).toBe(true);

    const renders = listRenders(db, chapterId);
    expect(renders).toHaveLength(1);
    expect(renders[0].path).toBe(out.renderPath);

    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.every((s) => s.status === 'done')).toBe(true);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('kısmi hata: başarısız segment failed+error, bölüm yine done', async () => {
    const { db, chapterId } = setup();
    const inner = new MockAdapter();
    let call = 0;
    const flaky: TtsAdapter = {
      id: 'flaky',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        if (++call === 2) return Promise.reject(new Error('kota doldu'));
        return inner.synthesize(req);
      },
    };
    const out = await generateChapter(db, chapterId, flaky);
    expect(out.failedCount).toBe(1);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs[1].status).toBe('failed');
    expect(segs[1].error).toMatch(/kota doldu/);
    expect(segs.filter((s) => s.status === 'done')).toHaveLength(4);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('script yoksa fırlatır', async () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    await expect(generateChapter(db, c.id, new MockAdapter())).rejects.toThrow(/script/i);
  });

  test('hiç segment üretilemezse bölüm error olur', async () => {
    const { db, chapterId } = setup();
    const broken: TtsAdapter = { id: 'broken', synthesize: () => Promise.reject(new Error('patladı')) };
    await expect(generateChapter(db, chapterId, broken)).rejects.toThrow();
    expect(getChapter(db, chapterId)?.status).toBe('error');
    expect(listRenders(db, chapterId)).toHaveLength(0);
  });

  test('single_voice ayarı tüm segment seslerini değiştirir (mock üstünden gözlem)', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'single_voice', 'gemini:Charon');
    const seen: string[] = [];
    const inner = new MockAdapter();
    const spy: TtsAdapter = {
      id: 'spy',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> { seen.push(req.voice.providerVoice); return inner.synthesize(req); },
    };
    await generateChapter(db, chapterId, spy);
    expect(new Set(seen)).toEqual(new Set(['Charon']));
  });
});

describe('adapterFromSettings', () => {
  test('provider=mock ayarıyla MockAdapter döner', () => {
    const db = createDb(':memory:');
    setSetting(db, 'provider', 'mock');
    expect(adapterFromSettings(db).id).toBe('mock');
  });

  test('gemini + anahtar yoksa Türkçe hata', () => {
    const db = createDb(':memory:');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(() => adapterFromSettings(db)).toThrow(/GEMINI_API_KEY/);
    } finally { if (saved) process.env.GEMINI_API_KEY = saved; }
  });
});
```

Not: `MockAdapter().id` değeri `'mock'` değilse (ör. `mock-tts`), önce `src/core/tts/mock.ts` içindeki gerçek `id`'ye bak ve testteki beklentiyi ona göre yaz — implementasyonu değil testi uyarlarsın (`src/core` değiştirilmez).

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/generation.test.ts`
Beklenen: FAIL — `lib/services/generation` yok.

- [ ] **Step 3: Servisi yaz**

`lib/services/generation.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders, segments } from '../db/schema';
import { newId } from '../id';
import { audioDir } from '../config';
import { getSetting } from './settings';
import { updateChapter } from './chapters';
import { latestScript, listSegments } from './scripts';
import { parseScript } from '@/src/core/schema';
import { generateEpisode } from '@/src/core/orchestrator';
import { overrideAllVoices } from '@/src/core/voices';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;
export interface GenerateOutcome { renderId: string; renderPath: string; segmentCount: number; failedCount: number; totalUsd: number; }

// Ayarlar (settings tablosu) → env → varsayılan sırasıyla adapter kur.
export function adapterFromSettings(db: Db): TtsAdapter {
  const provider = getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockAdapter();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil (.env)');
  return new GeminiAdapter(key, getSetting(db, 'model') ?? process.env.TTS_MODEL);
}

export function listRenders(db: Db, chapterId: string): RenderRow[] {
  return db.select().from(renders).where(eq(renders.chapterId, chapterId)).orderBy(desc(renders.createdAt)).all();
}

// Bölümün en güncel script'ini üretir; mp3 audioDir()/<chapterId>/<renderId>.mp3 olarak yazılır.
export async function generateChapter(
  db: Db, chapterId: string, adapter: TtsAdapter,
  onProgress?: (done: number, total: number) => void,
): Promise<GenerateOutcome> {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script yapıştırın');

  let script = parseScript(JSON.parse(scr.json));
  const single = getSetting(db, 'single_voice') ?? process.env.TTS_SINGLE_VOICE;
  if (single) script = overrideAllVoices(script, single);

  updateChapter(db, chapterId, { status: 'generating' });
  try {
    const r = await generateEpisode(script, adapter, onProgress);
    if (r.segments.length === 0) throw new Error('Hiç segment üretilemedi');

    const renderId = newId('rnd');
    const relPath = `${chapterId}/${renderId}.mp3`;
    await mkdir(join(audioDir(), chapterId), { recursive: true });
    await writeFile(join(audioDir(), relPath), r.mp3);

    const now = Date.now();
    db.insert(renders).values({ id: renderId, chapterId, scriptId: scr.id, path: relPath, durationSec: r.totalDurationMs / 1000, createdAt: now }).run();

    // Segment durumları: script segment id'si (s1, s2, ...) idx üzerinden eşlenir.
    const failedById = new Map(r.failed.map((f) => [f.id, f.error]));
    for (const row of listSegments(db, scr.id)) {
      const scriptSegId = script.segments[row.idx]?.id;
      const err = scriptSegId != null ? failedById.get(scriptSegId) : undefined;
      db.update(segments)
        .set(err ? { status: 'failed', error: err, updatedAt: now } : { status: 'done', error: null, updatedAt: now })
        .where(eq(segments.id, row.id)).run();
    }

    updateChapter(db, chapterId, { status: 'done' });
    return { renderId, renderPath: relPath, segmentCount: r.segments.length, failedCount: r.failed.length, totalUsd: r.totalUsd };
  } catch (e) {
    updateChapter(db, chapterId, { status: 'error' });
    throw e;
  }
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/generation.test.ts`
Beklenen: PASS (7 test). Not: mock adapter + ffmpeg gerçek çalışır (mevcut orchestrator testleri gibi) — ağ yok.

- [ ] **Step 5: Tüm testleri çalıştır**

Çalıştır: `npm test`
Beklenen: eski 23 + yeni panel testleri hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/generation.ts tests/panel/generation.test.ts
git commit -m "feat(panel): üretim servisi — çekirdek orkestratör + render/segment durumları"
```

---

### Task 7: Auth — token, middleware, login/logout

**Files:**
- Create: `lib/auth.ts`
- Create: `middleware.ts` (repo kökü)
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/login/page.tsx`
- Test: `tests/panel/auth.test.ts`

**Interfaces:**
- Consumes: — (Web Crypto; hem edge middleware hem node'da çalışır — `node:crypto` KULLANMA).
- Produces:
  - `COOKIE_NAME = 'panel_session'`
  - `createToken(secret: string, now?: number): Promise<string>` — `v1.<expiryMs>.<hmacBase64url>`; 30 gün geçerli.
  - `verifyToken(secret: string, token: string | undefined, now?: number): Promise<boolean>`
  - Middleware: `PANEL_PASSWORD` boşsa auth bypass; korumalı sayfa → `/login` redirect; korumalı `/api/*` → 401 JSON.

- [ ] **Step 1: Failing test yaz**

`tests/panel/auth.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createToken, verifyToken } from '@/lib/auth';

describe('auth token', () => {
  test('üret + doğrula (roundtrip)', async () => {
    const t = await createToken('gizli');
    expect(t).toMatch(/^v1\.\d+\./);
    expect(await verifyToken('gizli', t)).toBe(true);
  });

  test('yanlış secret reddedilir', async () => {
    const t = await createToken('gizli');
    expect(await verifyToken('baska', t)).toBe(false);
  });

  test('süresi dolmuş token reddedilir', async () => {
    const t = await createToken('gizli', Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(await verifyToken('gizli', t)).toBe(false);
  });

  test('çöp/boş token reddedilir', async () => {
    expect(await verifyToken('gizli', undefined)).toBe(false);
    expect(await verifyToken('gizli', 'saçmalık')).toBe(false);
    expect(await verifyToken('gizli', 'v1.123.abc')).toBe(false);
  });

  test('expiry ile oynanmış token reddedilir', async () => {
    const t = await createToken('gizli');
    const [v, , sig] = t.split('.');
    expect(await verifyToken('gizli', `${v}.${Date.now() + 999999999}.${sig}`)).toBe(false);
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/auth.test.ts`
Beklenen: FAIL — `lib/auth` yok.

- [ ] **Step 3: lib/auth.ts yaz**

```ts
// Web Crypto tabanlı (edge middleware + node uyumlu) basit HMAC oturum token'ı.
export const COOKIE_NAME = 'panel_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createToken(secret: string, now = Date.now()): Promise<string> {
  const body = `v1.${now + TTL_MS}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret: string, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [v, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return timingSafeEq(await hmac(secret, `${v}.${exp}`), sig);
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/auth.test.ts`
Beklenen: PASS (5 test).

- [ ] **Step 5: middleware.ts + auth rotaları + login sayfası**

`middleware.ts` (repo kökü):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifyToken } from './lib/auth';

const PUBLIC = [/^\/login$/, /^\/api\/auth\//];

export async function middleware(req: NextRequest) {
  const secret = process.env.PANEL_PASSWORD;
  if (!secret) return NextResponse.next(); // auth kapalı (lokal geliştirme) — README'de uyarı
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (await verifyToken(secret, req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/((?!_next/|favicon).*)'] };
```

`app/api/auth/login/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { COOKIE_NAME, createToken } from '@/lib/auth';

export async function POST(req: Request) {
  const secret = process.env.PANEL_PASSWORD;
  if (!secret) return NextResponse.json({ error: 'PANEL_PASSWORD ayarlı değil; auth kapalı' }, { status: 400 });
  const { password } = await req.json().catch(() => ({}));
  if (password !== secret) return NextResponse.json({ error: 'Hatalı şifre' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await createToken(secret), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
```

`app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
```

`app/login/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <form onSubmit={submit} className="card" style={{ maxWidth: '22rem', margin: '4rem auto' }}>
      <h1>Giriş</h1>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Panel şifresi" autoFocus />
      {err && <p className="err">{err}</p>}
      <p><button type="submit">Giriş yap</button></p>
    </form>
  );
}
```

- [ ] **Step 6: Build + testler**

Çalıştır: `npm run build && npm test`
Beklenen: build başarılı, tüm testler PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts middleware.ts app/api/auth/ app/login/ tests/panel/auth.test.ts
git commit -m "feat(panel): tek-sahip auth — HMAC cookie + middleware + login"
```

---

### Task 8: CRUD API rotaları (projects, chapters, script)

İnce sarmalayıcılar; iş mantığı servislerde. Testler handler fonksiyonlarını doğrudan çağırır (`setDbForTests` ile :memory: db).

**Files:**
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/[id]/route.ts`
- Create: `app/api/projects/[id]/chapters/route.ts`
- Create: `app/api/chapters/[id]/route.ts`
- Create: `app/api/chapters/[id]/script/route.ts`
- Test: `tests/panel/api-crud.test.ts`

**Interfaces:**
- Consumes: Task 3-6 servisleri; `getDb`/`setDbForTests`.
- Produces (Task 10 UI bunları çağırır):
  - `GET /api/projects` → `Project[]` · `POST {title, description?}` → 201 `Project` · `PATCH /api/projects/:id {title?, description?}` → `Project` · `DELETE` → 204
  - `GET /api/projects/:id` → `{ project, chapters: Chapter[] }`
  - `POST /api/projects/:id/chapters {title}` → 201 `Chapter`
  - `GET /api/chapters/:id` → `{ chapter, script: {id, version, segmentCount} | null, segments: SegmentRow[], renders: RenderRow[] }`
  - `PATCH /api/chapters/:id {title?, rawText?, narrationStyle?}` → `Chapter` · `DELETE` → 204
  - `PUT /api/chapters/:id/script` (gövde: ham script JSON metni) → `{ scriptId, version, segmentCount }`; hatada 400 `{ error }`.
- Not (Next 15): route context `{ params: Promise<{ id: string }> }` — `await params` gerekir.

- [ ] **Step 1: Failing test yaz**

`tests/panel/api-crud.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests } from '@/lib/db/client';
import * as projectsRoute from '@/app/api/projects/route';
import * as projectRoute from '@/app/api/projects/[id]/route';
import * as projChaptersRoute from '@/app/api/projects/[id]/chapters/route';
import * as chapterRoute from '@/app/api/chapters/[id]/route';
import * as scriptRoute from '@/app/api/chapters/[id]/script/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => setDbForTests(createDb(':memory:')));

describe('API CRUD', () => {
  test('proje oluştur/listele/güncelle/sil', async () => {
    const created = await (await projectsRoute.POST(jsonReq('POST', { title: 'Roman' }))).json();
    expect(created.id).toMatch(/^prj_/);

    const list = await (await projectsRoute.GET()).json();
    expect(list).toHaveLength(1);

    const patched = await (await projectRoute.PATCH(jsonReq('PATCH', { title: 'R2' }), ctx(created.id))).json();
    expect(patched.title).toBe('R2');

    const del = await projectRoute.DELETE(jsonReq('DELETE'), ctx(created.id));
    expect(del.status).toBe(204);
  });

  test('title eksikse 400', async () => {
    const res = await projectsRoute.POST(jsonReq('POST', {}));
    expect(res.status).toBe(400);
  });

  test('bölüm oluştur + kompozit GET + script import', async () => {
    const p = await (await projectsRoute.POST(jsonReq('POST', { title: 'R' }))).json();
    const c = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B1' }), ctx(p.id))).json();
    expect(c.position).toBe(1);

    // proje detayı bölümleri içerir
    const pd = await (await projectRoute.GET(jsonReq('GET'), ctx(p.id))).json();
    expect(pd.chapters).toHaveLength(1);

    // script import
    const put = await scriptRoute.PUT(new Request('http://p', { method: 'PUT', body: FIXTURE }), ctx(c.id));
    expect(put.status).toBe(200);
    expect((await put.json()).segmentCount).toBe(5);

    // kompozit bölüm GET
    const cd = await (await chapterRoute.GET(jsonReq('GET'), ctx(c.id))).json();
    expect(cd.chapter.status).toBe('scripted');
    expect(cd.script.version).toBe(1);
    expect(cd.segments).toHaveLength(5);
    expect(cd.renders).toEqual([]);
  });

  test('geçersiz script 400 + Türkçe hata', async () => {
    const p = await (await projectsRoute.POST(jsonReq('POST', { title: 'R' }))).json();
    const c = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B' }), ctx(p.id))).json();
    const res = await scriptRoute.PUT(new Request('http://p', { method: 'PUT', body: '{bozuk' }), ctx(c.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });

  test('olmayan kaynak 404', async () => {
    expect((await projectRoute.GET(jsonReq('GET'), ctx('prj_yok'))).status).toBe(404);
    expect((await chapterRoute.GET(jsonReq('GET'), ctx('chp_yok'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/api-crud.test.ts`
Beklenen: FAIL — rota modülleri yok.

- [ ] **Step 3: Rotaları yaz**

`app/api/projects/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createProject, listProjects } from '@/lib/services/projects';

export async function GET() {
  return NextResponse.json(listProjects(getDb()));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'title gerekli' }, { status: 400 });
  return NextResponse.json(createProject(getDb(), { title: body.title.trim(), description: body.description }), { status: 201 });
}
```

`app/api/projects/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteProject, getProject, updateProject } from '@/lib/services/projects';
import { listChapters } from '@/lib/services/chapters';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(getDb(), id);
  if (!project) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  return NextResponse.json({ project, chapters: listChapters(getDb(), id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = updateProject(getDb(), id, { title: body.title, description: body.description });
  if (!updated) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteProject(getDb(), (await params).id);
  return new NextResponse(null, { status: 204 });
}
```

`app/api/projects/[id]/chapters/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(getDb(), id)) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'title gerekli' }, { status: 400 });
  return NextResponse.json(createChapter(getDb(), id, { title: body.title.trim() }), { status: 201 });
}
```

`app/api/chapters/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteChapter, getChapter, updateChapter } from '@/lib/services/chapters';
import { latestScript, listSegments } from '@/lib/services/scripts';
import { listRenders } from '@/lib/services/generation';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const chapter = getChapter(db, id);
  if (!chapter) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  const scr = latestScript(db, id);
  const segments = scr ? listSegments(db, scr.id) : [];
  return NextResponse.json({
    chapter,
    script: scr ? { id: scr.id, version: scr.version, segmentCount: segments.length } : null,
    segments,
    renders: listRenders(db, id),
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = updateChapter(getDb(), id, { title: body.title, rawText: body.rawText, narrationStyle: body.narrationStyle });
  if (!updated) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteChapter(getDb(), (await params).id);
  return new NextResponse(null, { status: 204 });
}
```

`app/api/chapters/[id]/script/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '@/lib/db/client';
import { getChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getChapter(db, id)) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  const text = await req.text();
  try {
    return NextResponse.json(importScript(db, id, text));
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: `Geçersiz JSON: ${e.message}` }, { status: 400 });
    if (e instanceof ZodError) {
      const issues = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      return NextResponse.json({ error: `Şema hatası:\n${issues}` }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/api-crud.test.ts`
Beklenen: PASS (5 test).

- [ ] **Step 5: Build + tüm testler**

Çalıştır: `npm run build && npm test`
Beklenen: build başarılı, hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/projects/ app/api/chapters/ tests/panel/api-crud.test.ts
git commit -m "feat(panel): CRUD API rotaları — proje/bölüm/script import"
```

---

### Task 9: Üretim SSE rotası + ses servis rotası

**Files:**
- Create: `lib/paths.ts` (path-traversal koruması)
- Create: `app/api/chapters/[id]/generate/route.ts`
- Create: `app/api/audio/[...path]/route.ts`
- Test: `tests/panel/api-generate.test.ts`

**Interfaces:**
- Consumes: `generateChapter`, `adapterFromSettings` (Task 6); `audioDir()` (Task 2).
- Produces:
  - `safeAudioPath(parts: string[]): string | null` — `audioDir()` altına normalize edilmiş **mutlak** yol; dışarı kaçıyorsa `null`.
  - `POST /api/chapters/:id/generate` → SSE (`text/event-stream`): `event: progress` `{done,total}` · `event: done` `{renderId, renderPath, segmentCount, failedCount, totalUsd}` · `event: error` `{message}`.
  - `GET /api/audio/<chapterId>/<render>.mp3` → `audio/mpeg` (200; path traversal → 404).

- [ ] **Step 1: Failing test yaz**

`tests/panel/api-generate.test.ts`:

```ts
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { safeAudioPath } from '@/lib/paths';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import * as generateRoute from '@/app/api/chapters/[id]/generate/route';
import * as audioRoute from '@/app/api/audio/[...path]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-api-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

describe('safeAudioPath', () => {
  test('normal yol audioDir altında döner', () => {
    expect(safeAudioPath(['chp_1', 'rnd_1.mp3'])).toBe(join(audioDir(), 'chp_1', 'rnd_1.mp3'));
  });
  test('.. ile kaçış null döner', () => {
    expect(safeAudioPath(['..', 'app.db'])).toBeNull();
    expect(safeAudioPath(['chp_1', '..', '..', 'x'])).toBeNull();
  });
});

describe('generate SSE + audio servis', () => {
  test('mock provider ile uçtan uca: SSE progress+done, mp3 servis edilir', async () => {
    setSetting(db, 'provider', 'mock');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    importScript(db, c.id, FIXTURE);

    const res = await generateRoute.POST(new Request('http://p', { method: 'POST' }), ctx({ id: c.id }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await new Response(res.body).text();
    expect(body).toContain('event: progress');
    expect(body).toContain('event: done');

    const renderPath = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]).renderPath as string;
    const audio = await audioRoute.GET(new Request('http://p'), ctx({ path: renderPath.split('/') }));
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
  });

  test('script yoksa SSE error olayı', async () => {
    setSetting(db, 'provider', 'mock');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    const res = await generateRoute.POST(new Request('http://p', { method: 'POST' }), ctx({ id: c.id }));
    const body = await new Response(res.body).text();
    expect(body).toContain('event: error');
    expect(body).toContain('script');
  });

  test('audio: traversal 404', async () => {
    const res = await audioRoute.GET(new Request('http://p'), ctx({ path: ['..', 'app.db'] }));
    expect(res.status).toBe(404);
  });

  test('audio: olmayan dosya 404', async () => {
    const res = await audioRoute.GET(new Request('http://p'), ctx({ path: ['chp_yok', 'x.mp3'] }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/api-generate.test.ts`
Beklenen: FAIL — modüller yok.

- [ ] **Step 3: Implementasyon**

`lib/paths.ts`:

```ts
import { resolve, sep } from 'node:path';
import { audioDir } from './config';

// URL'den gelen parçaları audioDir altına çözer; dışarı kaçış girişiminde null.
export function safeAudioPath(parts: string[]): string | null {
  const base = resolve(audioDir());
  const full = resolve(base, ...parts);
  return full.startsWith(base + sep) ? full : null;
}
```

`app/api/chapters/[id]/generate/route.ts`:

```ts
import { getDb } from '@/lib/db/client';
import { adapterFromSettings, generateChapter } from '@/lib/services/generation';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const adapter = adapterFromSettings(db);
        const out = await generateChapter(db, id, adapter, (done, total) => send('progress', { done, total }));
        send('done', out);
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

`app/api/audio/[...path]/route.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { safeAudioPath } from '@/lib/paths';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const full = safeAudioPath(path);
  if (!full) return new Response('Bulunamadı', { status: 404 });
  try {
    const buf = await readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600' },
    });
  } catch {
    return new Response('Bulunamadı', { status: 404 });
  }
}
```

Not: Range desteği yok — `<audio>` çoğu tarayıcıda tam indirme ile çalışır; ileri sarma kısıtlı olabilir (Dilim D'de iyileştirilir; spec §10).

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/api-generate.test.ts`
Beklenen: PASS (6 test).

- [ ] **Step 5: Build + tüm testler**

Çalıştır: `npm run build && npm test`
Beklenen: build başarılı, hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/paths.ts app/api/chapters/ app/api/audio/ tests/panel/api-generate.test.ts
git commit -m "feat(panel): SSE üretim rotası + güvenli ses servis rotası"
```

---

### Task 10: UI sayfaları — proje listesi, bölüm listesi, çalışma alanı

Sayfalar client component + fetch (panel app-benzeri; tek veri yolu API). Otomatik test yok (Playwright ertelendi — spec §8); doğrulama manuel, mock provider ile.

**Files:**
- Modify: `app/page.tsx` (placeholder → proje listesi)
- Create: `app/projects/[id]/page.tsx`
- Create: `app/chapters/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 8-9 API sözleşmeleri (rota + JSON şekilleri yukarıda).
- Produces: `/` (projeler), `/projects/:id` (bölümler), `/chapters/:id` (çalışma alanı).

- [ ] **Step 1: app/page.tsx — proje listesi**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Project = { id: string; title: string; description: string | null };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
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
    if (!confirm('Proje ve tüm bölümleri silinecek. Emin misin?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }); load();
  }

  return (
    <>
      <h1>Projeler</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni proje adı" />
        <button type="submit">Ekle</button>
      </form>
      {projects.map((p) => (
        <div key={p.id} className="card row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/projects/${p.id}`}><strong>{p.title}</strong></Link>
          <button className="danger" onClick={() => remove(p.id)}>Sil</button>
        </div>
      ))}
      {projects.length === 0 && <p className="muted">Henüz proje yok. Yukarıdan ekle.</p>}
    </>
  );
}
```

- [ ] **Step 2: app/projects/[id]/page.tsx — bölüm listesi**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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
    if (!confirm('Bölüm silinecek. Emin misin?')) return;
    await fetch(`/api/chapters/${chapterId}`, { method: 'DELETE' }); load();
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  return (
    <>
      <p><Link href="/">← Projeler</Link></p>
      <h1>{detail.project.title}</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni bölüm adı" />
        <button type="submit">Ekle</button>
      </form>
      {detail.chapters.map((c) => (
        <div key={c.id} className="card row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/chapters/${c.id}`}><strong>{c.position}. {c.title}</strong></Link>
          <span className="row">
            <span className={`badge ${c.status}`}>{c.status}</span>
            <button className="danger" onClick={() => remove(c.id)}>Sil</button>
          </span>
        </div>
      ))}
      {detail.chapters.length === 0 && <p className="muted">Henüz bölüm yok.</p>}
    </>
  );
}
```

- [ ] **Step 3: app/chapters/[id]/page.tsx — çalışma alanı**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Chapter = { id: string; projectId: string; title: string; rawText: string; narrationStyle: string | null; status: string };
type Segment = { id: string; idx: number; speaker: string; style: string | null; text: string; status: string; error: string | null };
type Render = { id: string; path: string; durationSec: number | null; createdAt: number };
type Detail = { chapter: Chapter; script: { id: string; version: number; segmentCount: number } | null; segments: Segment[]; renders: Render[] };

// POST + SSE: EventSource sadece GET desteklediği için fetch-stream ile okunur.
async function streamGenerate(chapterId: string, onEvent: (ev: string, data: any) => void) {
  const res = await fetch(`/api/chapters/${chapterId}/generate`, { method: 'POST' });
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

export default function ChapterPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rawText, setRawText] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [scriptErr, setScriptErr] = useState('');
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string }>({ busy: false, done: 0, total: 0, err: '' });

  async function load() {
    const res = await fetch(`/api/chapters/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setRawText(d.chapter.rawText);
    setNarrationStyle(d.chapter.narrationStyle ?? '');
  }
  useEffect(() => { load(); }, [id]);

  async function saveText() {
    await fetch(`/api/chapters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawText, narrationStyle }) });
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
    await streamGenerate(id, (ev, data) => {
      if (ev === 'progress') setGenState((s) => ({ ...s, done: data.done, total: data.total }));
      if (ev === 'error') setGenState((s) => ({ ...s, err: data.message }));
    });
    setGenState((s) => ({ ...s, busy: false }));
    load();
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  const { chapter, script, segments, renders } = detail;

  return (
    <>
      <p><Link href={`/projects/${chapter.projectId}`}>← Bölümler</Link></p>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2>Ham metin + anlatım tarzı</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Bölümün ham metni (Dilim B'de LLM bunu script'e çevirecek)" /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder="Anlatım tarzı (ör. sakin, gizemli, üçüncü şahıs)" /></p>
        <button onClick={saveText}>Kaydet</button>
      </div>

      <div className="card">
        <h2>Seslendirme script’i {script && <span className="muted">(v{script.version}, {script.segmentCount} segment)</span>}</h2>
        <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder='Claude’un ürettiği JSON script’i buraya yapıştır' /></p>
        {scriptErr && <p className="err">{scriptErr}</p>}
        <button onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
      </div>

      <div className="card">
        <h2>Üretim</h2>
        <p className="row">
          <button onClick={generate} disabled={!script || genState.busy}>{genState.busy ? 'Üretiliyor…' : 'Üret'}</button>
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && <progress value={genState.done} max={genState.total} />}
        {genState.err && <p className="err">{genState.err}</p>}
        {renders.map((r) => (
          <p key={r.id} className="row">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? `${r.durationSec.toFixed(1)} sn` : ''} · {new Date(r.createdAt).toLocaleString('tr-TR')}</span>
          </p>
        ))}
      </div>

      {segments.length > 0 && (
        <div className="card">
          <h2>Segmentler</h2>
          <table>
            <thead><tr><th>#</th><th>Konuşan</th><th>Stil</th><th>Metin</th><th>Durum</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td>{s.idx + 1}</td><td>{s.speaker}</td><td className="muted">{s.style ?? ''}</td>
                  <td>{s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text}</td>
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

- [ ] **Step 4: Build + tüm testler**

Çalıştır: `npm run build && npm test`
Beklenen: build başarılı (3 sayfa derlenir), tüm testler PASS.

- [ ] **Step 5: Manuel uçtan uca doğrulama (mock provider — ücretsiz)**

1. `.env`'e ekle (geçici): `TTS_PROVIDER=mock` (PANEL_PASSWORD ekleme → auth bypass, hızlı test).
2. Çalıştır: `npm run dev` → tarayıcıda `http://localhost:3000`.
3. Proje oluştur → içine bölüm oluştur → bölümü aç.
4. `fixtures/sample-tr.json` içeriğini script alanına yapıştır → "Script kaydet" → 5 segment listelenmeli, durum `scripted`.
5. Bozuk JSON yapıştır → kırmızı Türkçe hata görünmeli.
6. "Üret" → ilerleme çubuğu 5/5'e gitmeli, oynatıcı görünmeli, ses çalmalı (mock: sessizlik/bip), durum `done`.
7. `PANEL_PASSWORD=test123` ekle, dev server'ı yeniden başlat → `/` → `/login`'e yönlenmeli; şifreyle gir → panel açılmalı.
8. Test bittiğinde `.env`'den `TTS_PROVIDER=mock`'u kaldır.

Beklenen: hepsi çalışır. Çalışmayan varsa düzelt (superpowers:systematic-debugging), sonra commit.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/projects/ app/chapters/
git commit -m "feat(panel): UI — proje listesi, bölüm listesi, bölüm çalışma alanı"
```

---

### Task 11: README, .env.example, .gitignore, CLAUDE.md güncellemeleri

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: tüm önceki task'lar (dokümante edilen davranış).
- Produces: public repo'ya hazır dokümantasyon + güncel proje durumu.

- [ ] **Step 1: .gitignore'a data dizinini ekle**

`.gitignore` içinde `# Audio artifacts` bölümünün üstüne şunu ekle:

```
# Panel verisi (SQLite + üretilen sesler) — asla commit edilmez
/data/
```

- [ ] **Step 2: .env.example'ı güncelle**

Dosyanın tamamını şununla değiştir:

```
# TTS (BYO-key: kendi anahtarını getir)
GEMINI_API_KEY=

# Panel girişi (boş bırakılırsa auth KAPALI — sadece lokal geliştirme için)
PANEL_PASSWORD=

# İsteğe bağlı: TTS ayarları (settings tablosu bunları geçersiz kılabilir)
# TTS_PROVIDER=gemini        # gemini | mock (mock = ücretsiz test)
# TTS_MODEL=gemini-3.1-flash-tts-preview
# TTS_SINGLE_VOICE=gemini:Charon   # tek anlatıcı modu

# İsteğe bağlı: veri dizini (varsayılan ./data)
# DATA_DIR=
```

- [ ] **Step 3: README.md oluştur**

```markdown
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
```

- [ ] **Step 4: CLAUDE.md'yi güncelle**

Şu değişiklikleri yap:

1. **"Temel kararlar" tablosunda** iki satırı değiştir:
   - `| Barındırma | ... |` satırı → `| Barındırma | **Self-host**: Next.js + SQLite (Drizzle) + yerel disk; tek-sahip auth (PANEL_PASSWORD). Public repo, BYO-key. ~~Supabase Cloud~~ (2026-07-16'da değişti) |`
   - `| Analiz akışı | ... |` satırı → `| Analiz akışı | Panel: raw_text → **LLM annotation panel içinde otomatik** (provider-agnostic, Dilim B) → script; elle JSON yapıştırma da destekli |`

2. **"Ne yapıldı / ne kaldı" bölümünü** şununla değiştir (Plan ②-⑤ yerine Dilim A-D):

```markdown
## Ne yapıldı / ne kaldı

- ✅ **Plan ① — Audio Core + Bake-off CLI**: saf TS çekirdek — zod şema, TTS adapter (Gemini + Mock), ffmpeg birleştirme, orkestratör, CLI. 23 test yeşil.
- ✅ **Dilim A — Panel iskeleti + veri katmanı + dikey dilim** (`docs/superpowers/specs/2026-07-16-panel-slice-a-design.md`, plan: `docs/superpowers/plans/2026-07-16-panel-slice-a.md`): Next.js panel, SQLite (Drizzle), tek-sahip auth, proje/bölüm CRUD, elle script import, mock/gemini ile üretim + SSE ilerleme + dinleme.
- ⬜ **Dilim B — LLM annotation**: provider-agnostic LLM adapter (Claude/GPT), ham metin + anlatım tarzı → chunk'lama → script; chunk ilerleme UI; script düzenle & yeniden üret. SONRAKİ.
- ⬜ **Dilim C — TTS üretim hattı**: DB-backed kuyruk, content-hash cache, maliyet, RPM/RPD ilerleme, tek-segment yeniden üretme + segment-başı ses dosyaları.
- ⬜ **Dilim D — Kütüphane + PWA oynatıcı**: liste·oynat·resume·MediaSession·offline.
```

3. **"Nasıl çalıştırılır" bölümünün başına** ekle:

```markdown
### Panel

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY + PANEL_PASSWORD
npm run dev            # http://localhost:3000  (test: TTS_PROVIDER=mock)
npm test               # vitest (çekirdek + panel testleri)
```

Veri: `./data/` (SQLite `app.db` + `audio/`); git-ignore'da.
```

4. **"Sonraki oturum için öneri"** bölümünü şununla değiştir:

```markdown
## Sonraki oturum için öneri

Dilim B (LLM annotation) için brainstorming/writing-plans: provider-agnostic LLM adapter, chunk'lama stratejisi, anlatım tarzı → sistem prompt tasarımı. RPD kotası hâlâ kritik (bkz. Bilinen kısıtlar #1) — hacim öncesi faturalamalı Gemini anahtarı veya Chirp adapter gündemde.
```

- [ ] **Step 5: Son doğrulama**

Çalıştır: `npm run build && npm test`
Beklenen: build + tüm testler PASS.

Çalıştır: `git status`
Beklenen: yalnızca bu task'ın dosyaları değişmiş; `data/` ignore edilmiş (listede görünmez).

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example .gitignore CLAUDE.md
git commit -m "docs: README (public repo) + env örneği + CLAUDE.md Dilim A durumu"
```

---

## Doğrulama Özeti

| Kontrol | Komut | Beklenen |
|---|---|---|
| Tüm testler | `npm test` | Eski 23 + yeni ~30 panel testi PASS |
| Build | `npm run build` | Hatasız |
| Uçtan uca (manuel) | Task 10 Step 5 | Mock ile üretim + dinleme çalışır |
| Sır sızıntısı | `git log -p -- .env` boş; `git status`'ta `data/` yok | Temiz |
