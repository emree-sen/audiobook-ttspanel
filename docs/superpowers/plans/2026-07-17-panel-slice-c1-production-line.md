# Panel Dilim C1 (Üretim Hattı) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TTS üretimini DB-destekli işlere (job) taşımak: preflight çağrı hesabı + kota defteri + content-hash cache + segment-başı dosyalar + tek-segment yeniden üretme + kotaya çarpınca duraklayıp "devam et" ile süren kuyruk.

**Architecture:** `lib/services/quota.ts` (defter+gün hesabı) → `preflight.ts` (hash+plan+ön hesap) → `producer.ts` (iş yürütme, süreç-içi tek worker, stitch). Üretim SSE'si "izleyici"ye dönüşür (`GET /progress`); `POST /generate` yalnız iş kuyruklar. `src/core` DEĞİŞMEZ (adapter + stitch aynen import edilir; `generateEpisode` CLI'da kalır).

**Tech Stack:** Mevcut yığın. Yeni bağımlılık YOK (`Intl.DateTimeFormat` ile TZ, `node:crypto` ile sha256).

**Spec:** `docs/superpowers/specs/2026-07-17-panel-slice-c1-production-line-design.md`

## Global Constraints

- `src/core/**` DEĞİŞMEZ. `lib/services/generation.ts` küçülür (generateChapter kalkar) ama `adapterFromSettings` + `listRenders` korunur.
- Kullanıcıya görünen metinler Türkçe; kompakt kod, Türkçe yorumlar.
- Testler ağa çıkmaz (MockAdapter/MockLlmAdapter); her task sonunda `npm run build && npm test` yeşil.
- **Test envanteri değişimi (bilinçli):** `tests/panel/generation.test.ts` SİLİNİR — davranış sözleşmeleri (başarılı üretim, kısmi hata, script-yok hatası, single_voice, hepsi-başarısız→error) `producer.test.ts`'te yeniden kurulur; `api-generate.test.ts` kuyruk akışına yeniden yazılır (safeAudioPath testleri korunur). Net test sayısı ARTAR.
- Kota anahtarı deseni: settings `quota_limit_<provider>`; gemini varsayılan **100**; gün sınırı gemini için **America/Los_Angeles**, diğerleri UTC.
- Hash girdisi: `provider|model|voice|style|tags|language|text` (sha256 hex).
- Segment dosyaları: `audioDir()/segments/<hash>.wav` (cache dosyası = segment dosyası).
- Bir bölümde aynı anda tek aktif iş; yeni enqueue eskisini `canceled` yapar.

---

### Task 1: Şema 0002 + kota servisi

**Files:**
- Modify: `lib/db/schema.ts` (jobs, tts_calls, audio_cache)
- Create: `drizzle/0002_*.sql` (`npm run db:generate` çıktısı — commit edilir)
- Create: `lib/services/quota.ts`
- Test: `tests/panel/quota.test.ts`

**Interfaces:**
- Consumes: `settings` servisi, `newId`.
- Produces:
  - Tablolar (aşağıda). `JobRow = typeof jobs.$inferSelect` sonraki task'larda kullanılır.
  - `activeProvider(db): { name: string; model: string }` — settings `provider`/`model` → env `TTS_PROVIDER`/`TTS_MODEL` → `'gemini'`/`''`.
  - `quotaDay(provider, at?): string` ("YYYY-MM-DD", sağlayıcı TZ'sinde).
  - `recordCall(db, { provider, model?, segmentId?, ok?, usd?, at? }): void`
  - `usedToday(db, provider, at?): number` · `quotaLimit(db, provider): number | null` · `remainingToday(db, provider, at?): number | null`

- [ ] **Step 1: Şemaya tabloları ekle**

`lib/db/schema.ts` — import satırını genişlet: `import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';` ve dosya sonuna ekle:

```ts
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'), // queued|running|done|error|canceled
  limitCalls: integer('limit_calls'),                 // kısmi üretim tavanı (null=sınırsız)
  callsUsed: integer('calls_used').notNull().default(0),
  doneCount: integer('done_count').notNull().default(0),
  totalCount: integer('total_count').notNull(),
  pausedReason: text('paused_reason'),                // quota|limit (status=queued iken duraklama nedeni)
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const ttsCalls = sqliteTable('tts_calls', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull().default(''),
  day: text('day').notNull(), // sağlayıcının sıfırlanma dilimine göre "YYYY-MM-DD"
  segmentId: text('segment_id'),
  ok: integer('ok').notNull().default(1),
  usd: real('usd').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('tts_calls_provider_day').on(t.provider, t.day)]);

export const audioCache = sqliteTable('audio_cache', {
  hash: text('hash').primaryKey(), // sha256: provider|model|voice|style|tags|language|text
  path: text('path').notNull(),    // audioDir'e göreli: "segments/<hash>.wav"
  durationMs: real('duration_ms').notNull().default(0),
  usd: real('usd').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
```

- [ ] **Step 2: Migrasyon üret** — `npm run db:generate` → `drizzle/0002_*.sql` (3 CREATE TABLE + 1 index). Commit edilecek.

- [ ] **Step 3: Failing test yaz**

`tests/panel/quota.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { setSetting } from '@/lib/services/settings';
import { activeProvider, quotaDay, quotaLimit, recordCall, remainingToday, usedToday } from '@/lib/services/quota';

describe('quotaDay', () => {
  test('gemini PT sınırı: kışın UTC 08:00 gün dönümü', () => {
    expect(quotaDay('gemini', Date.UTC(2026, 0, 15, 7, 59))).toBe('2026-01-14');
    expect(quotaDay('gemini', Date.UTC(2026, 0, 15, 8, 1))).toBe('2026-01-15');
  });
  test('bilinmeyen sağlayıcı UTC sayar', () => {
    expect(quotaDay('mock', Date.UTC(2026, 6, 17, 23, 59))).toBe('2026-07-17');
    expect(quotaDay('mock', Date.UTC(2026, 6, 18, 0, 1))).toBe('2026-07-18');
  });
});

describe('kota defteri', () => {
  test('record + usedToday + remaining; başarısız çağrı da sayılır', () => {
    const db = createDb(':memory:');
    expect(usedToday(db, 'gemini')).toBe(0);
    recordCall(db, { provider: 'gemini', segmentId: 'seg_x', usd: 0.001 });
    recordCall(db, { provider: 'gemini', ok: false });
    expect(usedToday(db, 'gemini')).toBe(2);
    expect(quotaLimit(db, 'gemini')).toBe(100);
    expect(remainingToday(db, 'gemini')).toBe(98);
  });
  test('limit settings ile değişir; mock limitsiz (null)', () => {
    const db = createDb(':memory:');
    setSetting(db, 'quota_limit_gemini', '1000');
    expect(quotaLimit(db, 'gemini')).toBe(1000);
    expect(quotaLimit(db, 'mock')).toBeNull();
    expect(remainingToday(db, 'mock')).toBeNull();
  });
  test('dünkü çağrı bugüne sayılmaz', () => {
    const db = createDb(':memory:');
    recordCall(db, { provider: 'gemini', at: Date.now() - 48 * 3600 * 1000 });
    expect(usedToday(db, 'gemini')).toBe(0);
  });
});

describe('activeProvider', () => {
  test('settings > env > varsayılan', () => {
    const db = createDb(':memory:');
    const saved = { p: process.env.TTS_PROVIDER, m: process.env.TTS_MODEL };
    delete process.env.TTS_PROVIDER; delete process.env.TTS_MODEL;
    try {
      expect(activeProvider(db)).toEqual({ name: 'gemini', model: '' });
      process.env.TTS_PROVIDER = 'mock';
      expect(activeProvider(db).name).toBe('mock');
      setSetting(db, 'provider', 'gemini');
      setSetting(db, 'model', 'x-model');
      expect(activeProvider(db)).toEqual({ name: 'gemini', model: 'x-model' });
    } finally {
      if (saved.p) process.env.TTS_PROVIDER = saved.p; else delete process.env.TTS_PROVIDER;
      if (saved.m) process.env.TTS_MODEL = saved.m; else delete process.env.TTS_MODEL;
    }
  });
});
```

- [ ] **Step 4: Fail doğrula** — `npx vitest run tests/panel/quota.test.ts` → FAIL.

- [ ] **Step 5: quota.ts yaz**

`lib/services/quota.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ttsCalls } from '../db/schema';
import { newId } from '../id';
import { getSetting } from './settings';

// Sağlayıcının kota gününün sıfırlandığı saat dilimi (gemini: gece PT).
const RESET_TZ: Record<string, string> = { gemini: 'America/Los_Angeles' };
const DEFAULT_LIMITS: Record<string, number> = { gemini: 100 };

export function activeProvider(db: Db): { name: string; model: string } {
  return {
    name: getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini',
    model: getSetting(db, 'model') ?? process.env.TTS_MODEL ?? '',
  };
}

export function quotaDay(provider: string, at = Date.now()): string {
  const timeZone = RESET_TZ[provider] ?? 'UTC';
  // en-CA yerel biçimi YYYY-MM-DD verir
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function recordCall(db: Db, c: { provider: string; model?: string; segmentId?: string; ok?: boolean; usd?: number; at?: number }): void {
  const at = c.at ?? Date.now();
  db.insert(ttsCalls).values({
    id: newId('cal'), provider: c.provider, model: c.model ?? '', day: quotaDay(c.provider, at),
    segmentId: c.segmentId ?? null, ok: c.ok === false ? 0 : 1, usd: c.usd ?? 0, createdAt: at,
  }).run();
}

export function usedToday(db: Db, provider: string, at = Date.now()): number {
  const r = db.select({ n: sql<number>`count(*)` }).from(ttsCalls)
    .where(and(eq(ttsCalls.provider, provider), eq(ttsCalls.day, quotaDay(provider, at)))).get();
  return r?.n ?? 0;
}

export function quotaLimit(db: Db, provider: string): number | null {
  const s = getSetting(db, `quota_limit_${provider}`);
  if (s != null) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  return DEFAULT_LIMITS[provider] ?? null;
}

export function remainingToday(db: Db, provider: string, at = Date.now()): number | null {
  const limit = quotaLimit(db, provider);
  if (limit == null) return null;
  return Math.max(0, limit - usedToday(db, provider, at));
}
```

- [ ] **Step 6: PASS + commit** — `npx vitest run tests/panel/quota.test.ts` → PASS (7). `npm run build && npm test` → yeşil.

```bash
git add lib/db/schema.ts drizzle/ lib/services/quota.ts tests/panel/quota.test.ts
git commit -m "feat(panel): şema 0002 (jobs/tts_calls/audio_cache) + kota defteri servisi"
```

---

### Task 2: Preflight servisi (hash + plan + ön hesap)

**Files:**
- Create: `lib/services/preflight.ts`
- Test: `tests/panel/preflight.test.ts`

**Interfaces:**
- Consumes: `activeProvider`/`quotaLimit`/`usedToday`/`remainingToday` (Task 1), `latestScript`, `getSetting`, `parseScript`, `overrideAllVoices`, `resolveVoiceForSpeaker`, `audioCache` tablosu.
- Produces:
  - `interface PlanItem { idx; hash; text; style?; tags?; voiceId; pauseAfterMs? }`
  - `segmentHash(i: { provider; model; voice; style?; tags?; language; text }): string`
  - `planChapter(db, chapterId, scriptId?): { scriptRow: ScriptRow; script: VoiceoverScript; plan: PlanItem[] }` — scriptId verilirse o versiyon (iş sabitlemesi), yoksa en güncel; single_voice ayarı uygulanır; stil = `[cast.baseStyle, seg.style]` birleşimi (orkestratörle aynı kural); script yoksa Türkçe `Error`.
  - `interface Preflight { total; cached; newCalls; quota: { provider; used; limit; remaining } | null; fits }`
  - `preflightChapter(db, chapterId): Preflight`

- [ ] **Step 1: Failing test yaz**

`tests/panel/preflight.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { audioCache } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { planChapter, preflightChapter, segmentHash } from '@/lib/services/preflight';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}

describe('segmentHash', () => {
  test('deterministik; her girdi hash\'i değiştirir', () => {
    const base = { provider: 'gemini', model: 'm', voice: 'gemini:Charon', style: 's', language: 'tr-TR', text: 'merhaba' };
    expect(segmentHash(base)).toBe(segmentHash({ ...base }));
    expect(segmentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const patch of [{ provider: 'x' }, { model: 'x' }, { voice: 'x:Y' }, { style: 'x' }, { text: 'x' }, { tags: ['[a]'] }]) {
      expect(segmentHash({ ...base, ...patch })).not.toBe(segmentHash(base));
    }
  });
});

describe('planChapter', () => {
  test('stil birleşimi orkestratör kuralıyla aynı; pause korunur', () => {
    const { db, chapterId } = setup();
    const { plan } = planChapter(db, chapterId);
    expect(plan).toHaveLength(5);
    // fixture s1: narrator base_style "sakin, ölçülü, üçüncü şahıs anlatım" + style "gizemli, yavaş"
    expect(plan[0].style).toBe('sakin, ölçülü, üçüncü şahıs anlatım, gizemli, yavaş');
    expect(plan[0].pauseAfterMs).toBe(400);
    expect(plan[0].voiceId).toBe('gemini:Charon');
  });
  test('single_voice tüm hash\'leri değiştirir', () => {
    const { db, chapterId } = setup();
    const before = planChapter(db, chapterId).plan.map((p) => p.hash);
    setSetting(db, 'single_voice', 'gemini:Iapetus');
    const after = planChapter(db, chapterId).plan.map((p) => p.hash);
    expect(after.every((h, i) => h !== before[i])).toBe(true);
  });
  test('script yoksa Türkçe hata', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect(() => planChapter(db, c.id)).toThrow(/script/i);
  });
});

describe('preflightChapter', () => {
  test('boş cache: newCalls=total; gemini varsayılan kota 100 ile fits', () => {
    const { db, chapterId } = setup();
    const pf = preflightChapter(db, chapterId);
    expect(pf).toMatchObject({ total: 5, cached: 0, newCalls: 5, fits: true });
    expect(pf.quota).toMatchObject({ provider: 'gemini', used: 0, limit: 100, remaining: 100 });
  });
  test('cache isabeti düşer', () => {
    const { db, chapterId } = setup();
    const { plan } = planChapter(db, chapterId);
    db.insert(audioCache).values({ hash: plan[0].hash, path: `segments/${plan[0].hash}.wav`, durationMs: 100, usd: 0, createdAt: 1 }).run();
    const pf = preflightChapter(db, chapterId);
    expect(pf.cached).toBe(1);
    expect(pf.newCalls).toBe(4);
  });
  test('kota yetmezse fits=false', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'quota_limit_gemini', '3');
    const pf = preflightChapter(db, chapterId);
    expect(pf.fits).toBe(false);
    expect(pf.quota?.remaining).toBe(3);
  });
  test('mock sağlayıcı: quota null, fits true', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock');
    const pf = preflightChapter(db, chapterId);
    expect(pf.quota).toBeNull();
    expect(pf.fits).toBe(true);
  });
});
```

- [ ] **Step 2: Fail doğrula** — `npx vitest run tests/panel/preflight.test.ts` → FAIL.

- [ ] **Step 3: preflight.ts yaz**

`lib/services/preflight.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { audioCache, scripts } from '../db/schema';
import { getSetting } from './settings';
import { latestScript, type ScriptRow } from './scripts';
import { activeProvider, quotaLimit, remainingToday, usedToday } from './quota';
import { parseScript } from '@/src/core/schema';
import { overrideAllVoices, resolveVoiceForSpeaker } from '@/src/core/voices';
import type { VoiceoverScript } from '@/src/core/types';

export interface PlanItem { idx: number; hash: string; text: string; style?: string; tags?: string[]; voiceId: string; pauseAfterMs?: number }

export function segmentHash(i: { provider: string; model: string; voice: string; style?: string; tags?: string[]; language: string; text: string }): string {
  return createHash('sha256')
    .update([i.provider, i.model, i.voice, i.style ?? '', (i.tags ?? []).join(','), i.language, i.text].join('|'))
    .digest('hex');
}

// Üretim planı: her segment için çözülmüş ses/stil + içerik hash'i.
// scriptId verilirse o versiyona sabitlenir (iş yürütme); yoksa en güncel (preflight).
export function planChapter(db: Db, chapterId: string, scriptId?: string): { scriptRow: ScriptRow; script: VoiceoverScript; plan: PlanItem[] } {
  const scr = scriptId
    ? db.select().from(scripts).where(eq(scripts.id, scriptId)).get()
    : latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script üretin');
  let script = parseScript(JSON.parse(scr.json));
  const single = getSetting(db, 'single_voice') ?? process.env.TTS_SINGLE_VOICE;
  if (single) script = overrideAllVoices(script, single);
  const { name: provider, model } = activeProvider(db);
  const plan = script.segments.map((seg, idx) => {
    const { cast } = resolveVoiceForSpeaker(script, seg.speaker);
    const style = [cast.baseStyle, seg.style].filter(Boolean).join(', ') || undefined; // orkestratörle aynı kural
    return {
      idx, text: seg.text, style, tags: seg.tags, voiceId: cast.voiceId, pauseAfterMs: seg.pauseAfterMs,
      hash: segmentHash({ provider, model, voice: cast.voiceId, style, tags: seg.tags, language: script.language, text: seg.text }),
    };
  });
  return { scriptRow: scr, script, plan };
}

export interface Preflight {
  total: number; cached: number; newCalls: number;
  quota: { provider: string; used: number; limit: number; remaining: number } | null;
  fits: boolean;
}

export function preflightChapter(db: Db, chapterId: string): Preflight {
  const { plan } = planChapter(db, chapterId);
  let cached = 0;
  for (const p of plan) if (db.select().from(audioCache).where(eq(audioCache.hash, p.hash)).get()) cached++;
  const newCalls = plan.length - cached;
  const { name: provider } = activeProvider(db);
  const limit = quotaLimit(db, provider);
  const quota = limit == null ? null : { provider, used: usedToday(db, provider), limit, remaining: remainingToday(db, provider)! };
  return { total: plan.length, cached, newCalls, quota, fits: quota == null || newCalls <= quota.remaining };
}
```

- [ ] **Step 4: PASS + commit** — `npx vitest run tests/panel/preflight.test.ts` → PASS (8). `npm test` → yeşil.

```bash
git add lib/services/preflight.ts tests/panel/preflight.test.ts
git commit -m "feat(panel): preflight — segment hash + üretim planı + çağrı/kota ön hesabı"
```

---

### Task 3: Producer — iş yürütme çekirdeği

**Files:**
- Create: `lib/services/producer.ts`
- Modify: `lib/services/generation.ts` (generateChapter + GenerateOutcome KALDIRILIR; adapterFromSettings + listRenders + RenderRow kalır; artık kullanılmayan import'lar temizlenir)
- Delete: `tests/panel/generation.test.ts` (sözleşmeler producer.test.ts'e taşınır)
- Test: `tests/panel/producer.test.ts`

**Interfaces:**
- Consumes: Task 1-2 üretimleri; `parseVoiceId`, `concatSegmentsToWav`, `wavToMp3`, `TtsAdapter` (`src/core`); `listSegments`, `updateChapter`, `audioDir`.
- Produces:
  - `type JobRow = typeof jobs.$inferSelect`
  - `latestJob(db, chapterId): JobRow | undefined`
  - `enqueueJob(db, chapterId, opts?: { limitCalls?: number }): JobRow` — script yoksa Türkçe hata; aktif işleri `canceled` yapar; script'in TÜM segmentlerini `pending`e sıfırlar; chapter `generating`.
  - `runJob(db, jobId, adapter): Promise<void>` — davranış sözleşmesi aşağıdaki kodda (cache isabeti çağrı harcamaz; `limitCalls`/kota tavanında `queued`+`pausedReason` ile duraklar; segment hatasında iş sürer; sonda stitch + render + chapter `done`; hiç segment yoksa `error`).
  - `resumeJob(db, jobId): JobRow` — yalnız `queued` işte; `limitCalls` ve `pausedReason` temizlenir (kullanıcı bilinçli devam etti).
  - `recoverJobs(db): void` — `running` kalmışları `queued`a düşürür (restart toparlama).
  - `ensureWorker(db): Promise<void>` — süreç-içi tek worker; duraklamış (pausedReason'lı) işlere DOKUNMAZ.
  - `stitchChapter(db, chapterId, scriptId): Promise<{ renderId; renderPath; durationSec }>`

- [ ] **Step 1: Failing test yaz**

`tests/panel/producer.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { jobs, ttsCalls } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { listRenders } from '@/lib/services/generation';
import { enqueueJob, ensureWorker, latestJob, recoverJobs, resumeJob, runJob } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '@/src/core/types';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-prod-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}
const callCount = (db: ReturnType<typeof createDb>) => db.select().from(ttsCalls).all().length;

describe('enqueueJob', () => {
  test('script yoksa Türkçe hata; aktif işi iptal eder', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect(() => enqueueJob(db, c.id)).toThrow(/script/i);
    importScript(db, c.id, FIXTURE);
    const j1 = enqueueJob(db, c.id);
    const j2 = enqueueJob(db, c.id);
    expect(db.select().from(jobs).where(eq(jobs.id, j1.id)).get()?.status).toBe('canceled');
    expect(j2.status).toBe('queued');
    expect(j2.totalCount).toBe(5);
    expect(getChapter(db, c.id)?.status).toBe('generating');
  });
});

describe('runJob', () => {
  test('tam üretim: segment dosyaları + cache + render + job/chapter done', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId);
    await runJob(db, job.id, new MockAdapter());
    const j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'done', doneCount: 5, callsUsed: 5 });
    expect(callCount(db)).toBe(5);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.every((s) => s.status === 'done' && s.audioPath?.startsWith('segments/') && s.contentHash)).toBe(true);
    expect(existsSync(join(audioDir(), segs[0].audioPath!))).toBe(true);
    expect(listRenders(db, chapterId)).toHaveLength(1);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('ikinci üretim tamamen cache\'ten: 0 yeni çağrı', async () => {
    const { db, chapterId } = setup();
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    const before = callCount(db);
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    expect(callCount(db)).toBe(before);
    expect(latestJob(db, chapterId)!.status).toBe('done');
    expect(listRenders(db, chapterId)).toHaveLength(2);
  });

  test('limitCalls: tavana gelince duraklar; resume limitsiz tamamlar', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId, { limitCalls: 2 });
    await runJob(db, job.id, new MockAdapter());
    let j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'queued', pausedReason: 'limit', callsUsed: 2, doneCount: 2 });
    expect(getChapter(db, chapterId)?.status).toBe('generating');
    const resumed = resumeJob(db, j.id);
    expect(resumed.limitCalls).toBeNull();
    await runJob(db, j.id, new MockAdapter());
    j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'done', doneCount: 5, callsUsed: 5 });
  });

  test('kota dolunca pausedReason=quota ile duraklar', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'quota_limit_gemini', '3'); // activeProvider varsayılanı gemini
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    const j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'queued', pausedReason: 'quota', doneCount: 3 });
  });

  test('segment hatası: failed + iş sürer + render oluşur', async () => {
    const { db, chapterId } = setup();
    const inner = new MockAdapter();
    let n = 0;
    const flaky: TtsAdapter = {
      id: 'flaky',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        if (++n === 2) return Promise.reject(new Error('kota doldu'));
        return inner.synthesize(req);
      },
    };
    await runJob(db, enqueueJob(db, chapterId).id, flaky);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.filter((s) => s.status === 'failed')).toHaveLength(1);
    expect(segs[1].error).toMatch(/kota doldu/);
    expect(latestJob(db, chapterId)!.status).toBe('done');
    expect(listRenders(db, chapterId)).toHaveLength(1);
    expect(callCount(db)).toBe(5); // başarısız da defterde
  });

  test('hepsi başarısız: job + chapter error, render yok', async () => {
    const { db, chapterId } = setup();
    const broken: TtsAdapter = { id: 'broken', synthesize: () => Promise.reject(new Error('patladı')) };
    await runJob(db, enqueueJob(db, chapterId).id, broken);
    expect(latestJob(db, chapterId)!.status).toBe('error');
    expect(getChapter(db, chapterId)?.status).toBe('error');
    expect(listRenders(db, chapterId)).toHaveLength(0);
  });

  test('single_voice üretimde de uygulanır (mock ses adı gözlemi)', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'single_voice', 'gemini:Charon');
    const seen: string[] = [];
    const inner = new MockAdapter();
    const spy: TtsAdapter = {
      id: 'spy',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> { seen.push(req.voice.providerVoice); return inner.synthesize(req); },
    };
    await runJob(db, enqueueJob(db, chapterId).id, spy);
    expect(new Set(seen)).toEqual(new Set(['Charon']));
  });
});

describe('recover + worker', () => {
  test('running kalmış iş queued\'a döner; ensureWorker bitirir', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock'); // adapterFromSettings → MockAdapter (ağ yok)
    const job = enqueueJob(db, chapterId);
    db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job.id)).run(); // çökmüş süreç simülasyonu
    recoverJobs(db);
    expect(latestJob(db, chapterId)!.status).toBe('queued');
    await ensureWorker(db);
    expect(latestJob(db, chapterId)!.status).toBe('done');
  });

  test('ensureWorker duraklamış (pausedReason) işi kendiliğinden sürdürmez', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock');
    const job = enqueueJob(db, chapterId, { limitCalls: 1 });
    await ensureWorker(db);
    expect(latestJob(db, chapterId)!).toMatchObject({ status: 'queued', pausedReason: 'limit', doneCount: 1 });
    await ensureWorker(db); // tekrar çağrı — hâlâ duraklı kalmalı
    expect(latestJob(db, chapterId)!.doneCount).toBe(1);
  });
});
```

- [ ] **Step 2: Fail doğrula** — `npx vitest run tests/panel/producer.test.ts` → FAIL.

- [ ] **Step 3: producer.ts yaz**

`lib/services/producer.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { audioCache, jobs, renders, segments } from '../db/schema';
import { newId } from '../id';
import { audioDir } from '../config';
import { updateChapter } from './chapters';
import { latestScript, listSegments } from './scripts';
import { activeProvider, recordCall, remainingToday } from './quota';
import { planChapter } from './preflight';
import { adapterFromSettings } from './generation';
import { parseVoiceId } from '@/src/core/voices';
import { concatSegmentsToWav, wavToMp3 } from '@/src/core/audio/stitch';
import type { TtsAdapter } from '@/src/core/types';

export type JobRow = typeof jobs.$inferSelect;

export function latestJob(db: Db, chapterId: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.chapterId, chapterId)).orderBy(desc(jobs.createdAt)).limit(1).get();
}

function setJob(db: Db, id: string, patch: Partial<JobRow>): void {
  db.update(jobs).set({ ...patch, updatedAt: Date.now() }).where(eq(jobs.id, id)).run();
}

// Bölüm için yeni iş kuyruklar; aktif işi iptal eder, segment durumlarını sıfırlar.
export function enqueueJob(db: Db, chapterId: string, opts?: { limitCalls?: number }): JobRow {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script üretin');
  const now = Date.now();
  db.update(jobs).set({ status: 'canceled', updatedAt: now })
    .where(and(eq(jobs.chapterId, chapterId), inArray(jobs.status, ['queued', 'running']))).run();
  const total = listSegments(db, scr.id).length;
  db.update(segments).set({ status: 'pending', error: null, updatedAt: now }).where(eq(segments.scriptId, scr.id)).run();
  const job: JobRow = {
    id: newId('job'), chapterId, scriptId: scr.id, status: 'queued',
    limitCalls: opts?.limitCalls ?? null, callsUsed: 0, doneCount: 0, totalCount: total,
    pausedReason: null, error: null, createdAt: now, updatedAt: now,
  };
  db.insert(jobs).values(job).run();
  updateChapter(db, chapterId, { status: 'generating' });
  return job;
}

// done segmentlerin dosyalarından bölüm mp3'ü birleştirir (pauseAfterMs korunur).
export async function stitchChapter(db: Db, chapterId: string, scriptId: string): Promise<{ renderId: string; renderPath: string; durationSec: number }> {
  const { plan } = planChapter(db, chapterId, scriptId);
  const parts: { wav: Buffer; pauseAfterMs?: number }[] = [];
  let totalMs = 0;
  for (const row of listSegments(db, scriptId)) {
    if (row.status !== 'done' || !row.audioPath) continue;
    parts.push({ wav: await readFile(join(audioDir(), row.audioPath)), pauseAfterMs: plan[row.idx]?.pauseAfterMs });
    if (row.contentHash) {
      const c = db.select().from(audioCache).where(eq(audioCache.hash, row.contentHash)).get();
      totalMs += c?.durationMs ?? 0;
    }
  }
  if (parts.length === 0) throw new Error('Hiç segment üretilemedi');
  const mp3 = await wavToMp3(concatSegmentsToWav(parts));
  const renderId = newId('rnd');
  const relPath = `${chapterId}/${renderId}.mp3`;
  await mkdir(join(audioDir(), chapterId), { recursive: true });
  await writeFile(join(audioDir(), relPath), mp3);
  db.insert(renders).values({ id: renderId, chapterId, scriptId, path: relPath, durationSec: totalMs / 1000, createdAt: Date.now() }).run();
  return { renderId, renderPath: relPath, durationSec: totalMs / 1000 };
}

// Segment kaydet + cache satırı + segment durumu (tek yerde).
async function saveSegmentAudio(db: Db, segmentRowId: string, hash: string, audio: Buffer, durationMs: number, usd: number): Promise<void> {
  const rel = `segments/${hash}.wav`;
  await mkdir(join(audioDir(), 'segments'), { recursive: true });
  await writeFile(join(audioDir(), rel), audio);
  db.insert(audioCache).values({ hash, path: rel, durationMs, usd, createdAt: Date.now() })
    .onConflictDoUpdate({ target: audioCache.hash, set: { path: rel, durationMs, usd } }).run();
  db.update(segments).set({ status: 'done', error: null, audioPath: rel, contentHash: hash, updatedAt: Date.now() })
    .where(eq(segments.id, segmentRowId)).run();
}

export async function runJob(db: Db, jobId: string, adapter: TtsAdapter): Promise<void> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
  setJob(db, job.id, { status: 'running', pausedReason: null });
  const { name: provider, model } = activeProvider(db);
  try {
    const { script, plan } = planChapter(db, job.chapterId, job.scriptId);
    const rows = listSegments(db, job.scriptId);
    let callsUsed = job.callsUsed;
    let doneCount = rows.filter((r) => r.status === 'done').length;
    for (const row of rows) {
      if (row.status === 'done') continue;
      const item = plan[row.idx];
      const cached = db.select().from(audioCache).where(eq(audioCache.hash, item.hash)).get();
      if (cached) { // cache isabeti: çağrı YOK, deftere yazılmaz
        db.update(segments).set({ status: 'done', error: null, audioPath: cached.path, contentHash: item.hash, updatedAt: Date.now() })
          .where(eq(segments.id, row.id)).run();
        setJob(db, job.id, { doneCount: ++doneCount });
        continue;
      }
      if (job.limitCalls != null && callsUsed >= job.limitCalls) {
        setJob(db, job.id, { status: 'queued', pausedReason: 'limit', callsUsed, doneCount });
        return;
      }
      const rem = remainingToday(db, provider);
      if (rem != null && rem <= 0) {
        setJob(db, job.id, { status: 'queued', pausedReason: 'quota', callsUsed, doneCount });
        return;
      }
      try {
        const res = await adapter.synthesize({
          text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
          style: item.style, tags: item.tags, pronunciations: script.pronunciations,
        });
        callsUsed++;
        recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: res.cost.usd ?? 0 });
        await saveSegmentAudio(db, row.id, item.hash, res.audio, res.durationMs, res.cost.usd ?? 0);
        setJob(db, job.id, { callsUsed, doneCount: ++doneCount });
      } catch (e) {
        callsUsed++;
        recordCall(db, { provider, model, segmentId: row.id, ok: false });
        db.update(segments).set({ status: 'failed', error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() })
          .where(eq(segments.id, row.id)).run();
        setJob(db, job.id, { callsUsed });
      }
    }
    await stitchChapter(db, job.chapterId, job.scriptId);
    setJob(db, job.id, { status: 'done', doneCount });
    updateChapter(db, job.chapterId, { status: 'done' });
  } catch (e) {
    setJob(db, job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    updateChapter(db, job.chapterId, { status: 'error' });
  }
}

// Duraklamış işi sürdürülebilir yapar: kullanıcı bilinçli devam etti → tavan kalkar.
export function resumeJob(db: Db, jobId: string): JobRow {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error('İş bulunamadı');
  if (job.status !== 'queued') throw new Error('İş duraklamış değil');
  db.update(jobs).set({ limitCalls: null, pausedReason: null, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
}

// Çökmüş süreçten kalan 'running' işleri kuyruğa geri düşürür.
export function recoverJobs(db: Db): void {
  db.update(jobs).set({ status: 'queued', updatedAt: Date.now() }).where(eq(jobs.status, 'running')).run();
}

// Süreç-içi tek worker: kuyruktaki (duraklamamış) işleri sırayla yürütür.
// Zaten çalışıyorsa AYNI koşunun promise'ini döndürür — await eden, sürmekte olan koşuya katılır
// (testlerde deterministik bekleme; rotalarda void ile ateşle-unut).
let workerPromise: Promise<void> | null = null;
export function ensureWorker(db: Db): Promise<void> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    try {
      recoverJobs(db);
      for (;;) {
        const next = db.select().from(jobs)
          .where(and(eq(jobs.status, 'queued'), isNull(jobs.pausedReason)))
          .orderBy(asc(jobs.createdAt)).limit(1).get();
        if (!next) break;
        await runJob(db, next.id, adapterFromSettings(db));
      }
    } finally {
      workerPromise = null;
    }
  })();
  return workerPromise;
}
```

- [ ] **Step 4: generation.ts'i küçült**

`lib/services/generation.ts` tam yeni içerik:

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders } from '../db/schema';
import { getSetting } from './settings';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;

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
```

Sil: `tests/panel/generation.test.ts` (`git rm`).

- [ ] **Step 5: PASS + tüm testler** — `npx vitest run tests/panel/producer.test.ts` → PASS (10). `npm run build && npm test` → yeşil (generation.test.ts artık yok; producer.test.ts sözleşmeleri taşıdı).

- [ ] **Step 6: Commit**

```bash
git add lib/services/producer.ts lib/services/generation.ts tests/panel/producer.test.ts
git rm tests/panel/generation.test.ts
git commit -m "feat(panel): producer — DB-destekli iş yürütme (cache, kota, duraklat/devam, stitch)"
```

---

### Task 4: Tek-segment yeniden üretme

**Files:**
- Modify: `lib/services/producer.ts` (regenerateSegment eklenir)
- Test: `tests/panel/regenerate.test.ts`

**Interfaces:**
- Consumes: Task 3 üretimleri.
- Produces: `regenerateSegment(db, segmentId, adapter): Promise<{ renderId; renderPath }>` — segment yoksa / bölümde aktif iş varsa / kota 0 ise Türkçe `Error`; başarıda 1 çağrı (defterde), cache+dosya üzerine yazılır, bölüm yeniden birleştirilir (yeni render).

- [ ] **Step 1: Failing test yaz**

`tests/panel/regenerate.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { ttsCalls } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { listRenders } from '@/lib/services/generation';
import { enqueueJob, regenerateSegment, runJob } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-regen-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

async function setupProduced() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  await runJob(db, enqueueJob(db, c.id).id, new MockAdapter());
  return { db, chapterId: c.id };
}

describe('regenerateSegment', () => {
  test('1 çağrı + yeni render; diğer segmentlere çağrı yok', async () => {
    const { db, chapterId } = await setupProduced();
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[1];
    const before = db.select().from(ttsCalls).all().length; // 5
    const out = await regenerateSegment(db, seg.id, new MockAdapter());
    expect(db.select().from(ttsCalls).all().length).toBe(before + 1);
    expect(listRenders(db, chapterId)).toHaveLength(2);
    expect(out.renderId).toMatch(/^rnd_/);
    expect(listSegments(db, latestScript(db, chapterId)!.id)[1].status).toBe('done');
  });

  test('bilinmeyen segment / aktif iş / kota 0 → Türkçe hatalar', async () => {
    const { db, chapterId } = await setupProduced();
    await expect(regenerateSegment(db, 'seg_yok', new MockAdapter())).rejects.toThrow(/Segment bulunamadı/);

    enqueueJob(db, chapterId); // aktif iş (queued)
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[0];
    await expect(regenerateSegment(db, seg.id, new MockAdapter())).rejects.toThrow(/aktif.*iş/i);
  });

  test('kota dolmuşsa reddeder', async () => {
    const { db, chapterId } = await setupProduced(); // 5 çağrı harcandı (provider: gemini varsayılan)
    setSetting(db, 'quota_limit_gemini', '5');
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[0];
    await expect(regenerateSegment(db, seg.id, new MockAdapter())).rejects.toThrow(/kota doldu/i);
  });
});
```

- [ ] **Step 2: Fail doğrula** — `npx vitest run tests/panel/regenerate.test.ts` → FAIL.

- [ ] **Step 3: producer.ts'e ekle** (dosya sonuna):

```ts
// Tek segmenti yeniden üretir (cache'i üzerine yazar) ve bölümü yeniden birleştirir.
export async function regenerateSegment(db: Db, segmentId: string, adapter: TtsAdapter): Promise<{ renderId: string; renderPath: string }> {
  const row = db.select().from(segments).where(eq(segments.id, segmentId)).get();
  if (!row) throw new Error('Segment bulunamadı');
  const active = db.select().from(jobs)
    .where(and(eq(jobs.chapterId, row.chapterId), inArray(jobs.status, ['queued', 'running']))).get();
  if (active) throw new Error('Bölümde aktif bir üretim işi var — önce bitmesini/duraklamasını iptal edin');
  const { name: provider, model } = activeProvider(db);
  const rem = remainingToday(db, provider);
  if (rem != null && rem <= 0) throw new Error('Bugünkü kota doldu — yarın tekrar deneyin');
  const { script, plan } = planChapter(db, row.chapterId, row.scriptId);
  const item = plan[row.idx];
  try {
    const res = await adapter.synthesize({
      text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
      style: item.style, tags: item.tags, pronunciations: script.pronunciations,
    });
    recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: res.cost.usd ?? 0 });
    await saveSegmentAudio(db, row.id, item.hash, res.audio, res.durationMs, res.cost.usd ?? 0);
  } catch (e) {
    recordCall(db, { provider, model, segmentId: row.id, ok: false });
    throw new Error(`Segment üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
  }
  const st = await stitchChapter(db, row.chapterId, row.scriptId);
  return { renderId: st.renderId, renderPath: st.renderPath };
}
```

Not: `regenerateSegment` başarısız synthesize'da da deftere `ok:false` yazar (istek harcandı).

- [ ] **Step 4: PASS + commit** — `npx vitest run tests/panel/regenerate.test.ts` → PASS (3+). `npm test` → yeşil.

```bash
git add lib/services/producer.ts tests/panel/regenerate.test.ts
git commit -m "feat(panel): tek-segment yeniden üretme + yeniden birleştirme"
```

---

### Task 5: API rotaları

**Files:**
- Create: `app/api/chapters/[id]/preflight/route.ts`
- Modify: `app/api/chapters/[id]/generate/route.ts` (SSE → kuyruklama; TAM değişim)
- Create: `app/api/chapters/[id]/progress/route.ts` (SSE izleyici)
- Create: `app/api/jobs/[id]/resume/route.ts`
- Create: `app/api/segments/[id]/regenerate/route.ts`
- Modify: `tests/panel/api-generate.test.ts` (TAM yeniden yazım — safeAudioPath testleri korunur)

**Interfaces:**
- Consumes: Task 2-4 servisleri.
- Produces (UI sözleşmesi):
  - `GET /api/chapters/:id/preflight` → `Preflight` | 404/400 `{error}`
  - `POST /api/chapters/:id/generate` gövde `{limitCalls?}` → 202 `{jobId}` | 400 `{error}` (artık SSE DEĞİL)
  - `GET /api/chapters/:id/progress` → SSE: `progress {jobId,done,total,status}` (400ms'de bir) · `done {jobId,done,total,renderId,renderPath,failedCount}` · `paused {jobId,done,total,reason}` · `failed {message,...}`; iş yoksa `failed`. İstemci kopması işi ETKİLEMEZ. Rota başında `void ensureWorker(db)` (restart toparlama).
  - `POST /api/jobs/:id/resume` → `{ok,jobId}` | 400
  - `POST /api/segments/:id/regenerate` → `{renderId,renderPath}` | 400

- [ ] **Step 1: Failing test yaz**

`tests/panel/api-generate.test.ts` tam yeni içerik:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { safeAudioPath } from '@/lib/paths';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { ensureWorker } from '@/lib/services/producer';
import * as preflightRoute from '@/app/api/chapters/[id]/preflight/route';
import * as generateRoute from '@/app/api/chapters/[id]/generate/route';
import * as progressRoute from '@/app/api/chapters/[id]/progress/route';
import * as resumeRoute from '@/app/api/jobs/[id]/resume/route';
import * as regenRoute from '@/app/api/segments/[id]/regenerate/route';
import * as audioRoute from '@/app/api/audio/[...path]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-api-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); setSetting(db, 'provider', 'mock'); });

function mkChapter() {
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B' });
  importScript(db, c.id, FIXTURE);
  return c.id;
}

describe('safeAudioPath', () => {
  test('normal yol audioDir altında; traversal null', () => {
    expect(safeAudioPath(['chp_1', 'rnd_1.mp3'])).toBe(join(audioDir(), 'chp_1', 'rnd_1.mp3'));
    expect(safeAudioPath(['..', 'app.db'])).toBeNull();
    expect(safeAudioPath(['chp_1', '..', '..', 'x'])).toBeNull();
  });
});

describe('preflight rotası', () => {
  test('script varken hesap; script yokken 400; bölüm yokken 404', async () => {
    const id = mkChapter();
    const pf = await (await preflightRoute.GET(jsonReq('GET'), ctx({ id }))).json();
    expect(pf).toMatchObject({ total: 5, cached: 0, newCalls: 5 });
    expect(pf.quota).toBeNull(); // provider mock → limitsiz

    const p2 = createProject(db, { title: 'R2' });
    const bos = createChapter(db, p2.id, { title: 'B' });
    expect((await preflightRoute.GET(jsonReq('GET'), ctx({ id: bos.id }))).status).toBe(400);
    expect((await preflightRoute.GET(jsonReq('GET'), ctx({ id: 'chp_yok' }))).status).toBe(404);
  });
});

describe('generate + progress + audio', () => {
  test('kuyrukla + worker bitir + progress done + mp3 servis', async () => {
    const id = mkChapter();
    const res = await generateRoute.POST(jsonReq('POST', {}), ctx({ id }));
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    expect(jobId).toMatch(/^job_/);

    await ensureWorker(db); // testte deterministik bekleyiş

    const body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: done');
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]);
    expect(done).toMatchObject({ done: 5, total: 5, failedCount: 0 });

    const audio = await audioRoute.GET(jsonReq('GET'), ctx({ path: (done.renderPath as string).split('/') }));
    expect(audio.status).toBe(200);
  });

  test('limitCalls ile duraklar; resume tamamlar', async () => {
    const id = mkChapter(); // provider beforeEach'te mock — limitCalls sağlayıcıdan bağımsız duraklatır
    const res = await generateRoute.POST(jsonReq('POST', { limitCalls: 2 }), ctx({ id }));
    const { jobId } = await res.json();
    await ensureWorker(db);

    let body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: paused');
    expect(body).toContain('"reason":"limit"');

    expect((await resumeRoute.POST(jsonReq('POST'), ctx({ id: jobId }))).status).toBe(200);
    await ensureWorker(db);
    body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: done');
  });

  test('script yokken generate 400; iş yokken progress failed', async () => {
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect((await generateRoute.POST(jsonReq('POST', {}), ctx({ id: c.id }))).status).toBe(400);
    const body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id: c.id }))).body).text();
    expect(body).toContain('event: failed');
  });
});

describe('regenerate rotası', () => {
  test('başarılı + bilinmeyen segment 400', async () => {
    const id = mkChapter();
    await generateRoute.POST(jsonReq('POST', {}), ctx({ id }));
    await ensureWorker(db);
    const seg = listSegments(db, latestScript(db, id)!.id)[0];
    const ok = await regenRoute.POST(jsonReq('POST'), ctx({ id: seg.id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).renderId).toMatch(/^rnd_/);
    expect((await regenRoute.POST(jsonReq('POST'), ctx({ id: 'seg_yok' }))).status).toBe(400);
  });
});
```

Not (spec §7 sapması, bilinçli): spec segment satırında "önbellekten geldi" rozeti istiyordu; DB'de taze-üretim ile cache-isabeti ayrımı tutulmadığından (ikisi de `done`+`contentHash`) rozet düşürüldü — önbellek bilgisi preflight satırında ("M önbellekte") verilir. Final review bunu sapma değil karar olarak bilsin.

- [ ] **Step 2: Fail doğrula** — `npx vitest run tests/panel/api-generate.test.ts` → FAIL.

- [ ] **Step 3: Rotaları yaz**

`app/api/chapters/[id]/preflight/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getChapter } from '@/lib/services/chapters';
import { preflightChapter } from '@/lib/services/preflight';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getChapter(db, id)) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  try {
    return NextResponse.json(preflightChapter(db, id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/chapters/[id]/generate/route.ts` (TAM değişim):

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { enqueueJob, ensureWorker } from '@/lib/services/producer';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const limitCalls = typeof body.limitCalls === 'number' && body.limitCalls >= 1 ? Math.floor(body.limitCalls) : undefined;
  try {
    const job = enqueueJob(db, id, { limitCalls });
    void ensureWorker(db); // arka planda sürer; yanıt beklemez
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/chapters/[id]/progress/route.ts`:

```ts
import { getDb } from '@/lib/db/client';
import { ensureWorker, latestJob } from '@/lib/services/producer';
import { listRenders } from '@/lib/services/generation';
import { listSegments } from '@/lib/services/scripts';

export const dynamic = 'force-dynamic';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  void ensureWorker(db); // yeniden başlatma sonrası bekleyen işleri toparlar
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): boolean => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); return true; }
        catch { return false; } // istemci koptu — iş etkilenmez
      };
      for (;;) {
        const job = latestJob(db, id);
        if (!job) { send('failed', { message: 'Bu bölüm için iş yok' }); break; }
        const base = { jobId: job.id, done: job.doneCount, total: job.totalCount, status: job.status };
        if (job.status === 'running' || (job.status === 'queued' && !job.pausedReason)) {
          if (!send('progress', base)) break;
          await sleep(400);
          continue;
        }
        if (job.status === 'done') {
          const render = listRenders(db, id)[0];
          const failedCount = listSegments(db, job.scriptId).filter((s) => s.status === 'failed').length;
          send('done', { ...base, renderId: render?.id, renderPath: render?.path, failedCount });
        } else if (job.status === 'queued') {
          send('paused', { ...base, reason: job.pausedReason });
        } else {
          send('failed', { ...base, message: job.error ?? 'İş iptal edildi' });
        }
        break;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

`app/api/jobs/[id]/resume/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { ensureWorker, resumeJob } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    const job = resumeJob(db, id);
    void ensureWorker(db);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/segments/[id]/regenerate/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { adapterFromSettings } from '@/lib/services/generation';
import { regenerateSegment } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    return NextResponse.json(await regenerateSegment(db, id, adapterFromSettings(db)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 4: PASS + build** — `npx vitest run tests/panel/api-generate.test.ts` → PASS (7). `npm run build && npm test` → yeşil.

- [ ] **Step 5: Commit**

```bash
git add app/api/chapters/ app/api/jobs/ app/api/segments/ tests/panel/api-generate.test.ts
git commit -m "feat(panel): üretim API'si — preflight, kuyruklama, progress SSE, resume, regenerate"
```

---

### Task 6: UI — Üretim kartı + segment araçları

**Files:**
- Modify: `app/chapters/[id]/page.tsx` (Üretim kartı ve segment tablosu bölümleri değişir; annotate/script akışı AYNEN kalır)

**Interfaces:**
- Consumes: Task 5 API sözleşmeleri; mevcut UI bileşenleri (`Icon`, `EmptyState`, `Eq`), `refreshTree`.
- Produces: preflight satırı; fits'e göre tek/çift üret düğmesi; `EventSource` ile progress izleme (sayfa açılışında `chapter.status==='generating'` ise otomatik bağlanır); paused durumu + "Devam et"; segment ▶ dinleme + 🔁 yeniden üretme.

- [ ] **Step 1: page.tsx'i güncelle**

Mevcut dosyada ŞU değişiklikleri yap (annotate/cast/script bölümlerine DOKUNMA):

1. `Segment` tipine alan ekle: `audioPath: string | null;` (mevcut alanların yanına).
2. `streamSse` KALIR (annotate kullanıyor). Yeni state ve yardımcılar — `genState` tanımını değiştir ve yenilerini ekle:

```tsx
  type Preflight = { total: number; cached: number; newCalls: number; quota: { provider: string; used: number; limit: number; remaining: number } | null; fits: boolean };
  const [pf, setPf] = useState<Preflight | null>(null);
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string; paused: { reason: string; jobId: string } | null }>({ busy: false, done: 0, total: 0, err: '', paused: null });
  const [playingSeg, setPlayingSeg] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
```

(`useRef`'i react import'una ekle.)

3. `load()` içinde, `setDetail(d)` SONRASINA ekle: `if (d.script) loadPreflight();` ve `if (d.chapter.status === 'generating') watchProgress();` — ve yeni fonksiyonlar:

```tsx
  async function loadPreflight() {
    const res = await fetch(`/api/chapters/${id}/preflight`);
    setPf(res.ok ? await res.json() : null);
  }

  // Üretimi izle: EventSource (GET SSE). Bağlantı kopması işi etkilemez.
  function watchProgress() {
    esRef.current?.close();
    const es = new EventSource(`/api/chapters/${id}/progress`);
    esRef.current = es;
    setGenState((s) => ({ ...s, busy: true, err: '', paused: null }));
    es.addEventListener('progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setGenState((s) => ({ ...s, done: d.done, total: d.total }));
    });
    es.addEventListener('done', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState({ busy: false, done: d.done, total: d.total, err: d.failedCount ? `${d.failedCount} segment üretilemedi` : '', paused: null });
      refreshTree(); load(); loadPreflight();
    });
    es.addEventListener('paused', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState({ busy: false, done: d.done, total: d.total, err: '', paused: { reason: d.reason, jobId: d.jobId } });
      refreshTree(); load(); loadPreflight();
    });
    es.addEventListener('failed', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState((s) => ({ ...s, busy: false, err: d.message ?? 'Üretim başarısız', paused: null }));
      refreshTree(); load(); loadPreflight();
    });
    es.onerror = () => { es.close(); setGenState((s) => ({ ...s, busy: false })); load(); };
  }

  async function generate(limitCalls?: number) {
    setGenState({ busy: true, done: 0, total: pf?.total ?? 0, err: '', paused: null });
    const res = await fetch(`/api/chapters/${id}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limitCalls ? { limitCalls } : {}),
    });
    if (!res.ok) { setGenState((s) => ({ ...s, busy: false, err: (await res.json()).error ?? 'Üretim başlatılamadı' })); return; }
    watchProgress();
  }

  async function resume(jobId: string) {
    const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    if (res.ok) watchProgress();
    else setGenState((s) => ({ ...s, err: 'Devam ettirilemedi' }));
  }

  async function regenerate(segmentId: string) {
    setRegenBusy(segmentId);
    try {
      const res = await fetch(`/api/segments/${segmentId}/regenerate`, { method: 'POST' });
      if (!res.ok) setGenState((s) => ({ ...s, err: (await res.json()).error ?? 'Segment yeniden üretilemedi' }));
      refreshTree(); load(); loadPreflight();
    } finally { setRegenBusy(null); }
  }
```

Ayrıca unmount temizliği: `useEffect(() => () => esRef.current?.close(), []);`

4. Annotate/saveScript/changeVoice başarı yollarındaki `load();` çağrılarının yanına `loadPreflight();` ekle (script değişince hesap tazelenir).

5. **Üretim kartını** şu içerikle değiştir:

```tsx
      <div className="card">
        <h2><span className="stage">03</span> Üretim {genState.busy && <Icon name="spinner" />}</h2>
        {pf && (
          <p className="muted">
            {pf.total} segment · {pf.cached} önbellekte · <strong>{pf.newCalls} yeni çağrı</strong>
            {pf.quota && <> · {pf.quota.provider} bugün {pf.quota.used}/{pf.quota.limit}</>}
          </p>
        )}
        <p className="row">
          {(!pf || pf.fits) && (
            <button onClick={() => generate()} disabled={!script || genState.busy}>
              <Icon name="play" /> {genState.busy ? 'Üretiliyor…' : 'Üret'}
            </button>
          )}
          {pf && !pf.fits && pf.quota && (
            <>
              <button onClick={() => generate(pf.quota!.remaining)} disabled={genState.busy || pf.quota.remaining < 1}>
                <Icon name="play" /> İlk {pf.quota.remaining}’i üret
              </button>
              <button className="ghost" onClick={() => generate()} disabled={genState.busy}>Yine de hepsini dene</button>
            </>
          )}
          {genState.busy && <Eq />}
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && (genState.busy || genState.paused) && <progress value={genState.done} max={genState.total} />}
        {genState.paused && (
          <p className="row">
            <span className="badge generating">duraklatıldı</span>
            <span className="muted">
              {genState.paused.reason === 'quota' ? 'Günlük kota doldu' : 'Çağrı tavanına ulaşıldı'} — {genState.done}/{genState.total} üretildi, kalanlar kuyrukta.
            </span>
            <button className="ghost" onClick={() => resume(genState.paused!.jobId)}>Devam et</button>
          </p>
        )}
        {genState.err && <p className="err">{genState.err}</p>}
        {renders.map((r) => (
          <p key={r.id} className="player">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? `${r.durationSec.toFixed(1)} sn` : ''} · {new Date(r.createdAt).toLocaleString('tr-TR')}</span>
          </p>
        ))}
      </div>
```

6. **Segment tablosunda** durum hücresini araçlarla genişlet — `<td>` (Durum) şu hale gelir:

```tsx
                  <td>
                    <span className="row" style={{ gap: '0.3rem', flexWrap: 'nowrap' }}>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {s.audioPath && (
                        <button className="icon" onClick={() => setPlayingSeg(playingSeg === s.id ? null : s.id)} aria-label="Segmenti dinle" title="Segmenti dinle"><Icon name="play" size={13} /></button>
                      )}
                      <button className="icon" onClick={() => regenerate(s.id)} disabled={genState.busy || annState.busy || regenBusy !== null} aria-label="Yeniden üret (1 çağrı)" title="Yeniden üret (1 çağrı)">
                        {regenBusy === s.id ? <Icon name="spinner" size={13} /> : <Icon name="wave" size={13} />}
                      </button>
                    </span>
                    {s.error && <div className="err">{s.error}</div>}
                    {playingSeg === s.id && s.audioPath && <div><audio controls autoPlay src={`/api/audio/${s.audioPath}`} style={{ height: 28, maxWidth: '14rem' }} /></div>}
                  </td>
```

- [ ] **Step 2: Build + tüm testler** — `npm run build && npm test` → yeşil.

- [ ] **Step 3: Commit**

```bash
git add "app/chapters/[id]/page.tsx"
git commit -m "feat(ui): üretim kartı — preflight/kota göstergesi, duraklat-devam, segment dinle/yeniden üret"
```

---

### Task 7: Docs + headless smoke

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.env.example`

**Interfaces:** —

- [ ] **Step 1: Headless smoke** (mock TTS+LLM, port 3130, throwaway DATA_DIR; önceki smoke'ların netstat+taskkill süreç desenini kullan):
1. Proje+bölüm+script (fixture) kur.
2. `GET preflight` → `total:5, newCalls:5, quota:null` (mock).
3. `POST generate {"limitCalls":2}` → 202 jobId; `GET progress` → `event: paused` `"reason":"limit"` (progress rotasındaki ensureWorker işi yürütür; paused'a dek bir-iki progress olayı normal).
4. `POST /api/jobs/<id>/resume` → `GET progress` → `event: done`; `GET /api/audio/<renderPath>` → 200.
5. `GET preflight` tekrar → `cached:5, newCalls:0`.
6. Segment id al (`GET /api/chapters/:id` → segments[0].id) → `POST /api/segments/<id>/regenerate` → 200 renderId.
7. Temizlik.

- [ ] **Step 2: Dokümanları güncelle**

`.env.example` — LLM bloğundan sonra ekle:

```
# İsteğe bağlı: TTS kota tavanları (settings tablosundan da ayarlanabilir: quota_limit_<provider>)
# Gemini free-tier varsayılanı panelde 100/gün olarak kabul edilir; faturalı anahtarda paneldeki
# ayarı yükseltin (şimdilik: sqlite settings tablosu, key=quota_limit_gemini).
```

`README.md`:
1. "Durum" listesinde `⬜ Sağlam üretim kuyruğu...` satırını şu iki satırla değiştir:

```markdown
- ✅ Üretim hattı: DB-destekli kuyruk (tarayıcı kapansa da sürer), preflight çağrı hesabı + günlük kota göstergesi, kotaya çarpınca duraklat/devam, content-hash önbelleği (değişmeyen segment tekrar TTS'e gitmez), segment başına dinleme + tek-segment yeniden üretme
- ⬜ Sağlayıcı ekosistemi (OpenAI-uyumlu endpoint + Piper lokal TTS + ayarlar ekranı), PWA oynatıcı
```

2. "Bilinen kısıtlar" bölümündeki Gemini 100/gün maddesini şununla değiştir:

```markdown
- Gemini TTS free tier: **günde 100 istek** (model başına). Panel bunu yönetir: üretim öncesi kaç çağrı gerektiğini gösterir, hak bitince işi duraklatır, ertesi gün "Devam et" ile sürersiniz. Faturalı anahtarda `quota_limit_gemini` ayarını yükseltin.
```

`CLAUDE.md`:
1. "Ne yapıldı" listesine UI Redesign satırından SONRA ekle:

```markdown
- ✅ **Dilim C1 — Üretim hattı** (`docs/superpowers/specs/2026-07-17-panel-slice-c1-production-line-design.md`, plan: `docs/superpowers/plans/2026-07-17-panel-slice-c1-production-line.md`): jobs/tts_calls/audio_cache tabloları, preflight çağrı+kota hesabı, DB-destekli kuyruk (duraklat/devam, restart toparlama), content-hash cache, segment dosyaları + tek-segment yeniden üretme, progress SSE izleyici.
```

2. Dilim C satırını şu hale getir (C2 kaldı):

```markdown
- ⬜ **Dilim C2 — Sağlayıcı ekosistemi**: OpenAI-uyumlu endpoint + Piper lokal TTS adapter'ları, sağlayıcı ayarlar ekranı, sağlayıcı-bazlı ses havuzu, adapter yetenek bildirimi. SONRAKİ.
```

3. "Bilinen kısıtlar #1" maddesinin SONUNA ekle: ` GÜNCELLEME (C1): panel artık preflight + kota defteri + duraklat/devam ile bu limiti yönetiyor; faturalama/Chirp kararı C2 ile birlikte.`

4. "Sonraki oturum için öneri" bölümünü şununla değiştir:

```markdown
## Sonraki oturum için öneri

Dilim C2 (sağlayıcı ekosistemi) için brainstorming: OpenAI-uyumlu endpoint adapter (lokal sunucular), Piper yerleşik lokal TTS, sağlayıcı ayarlar ekranı, sağlayıcı-bazlı ses havuzu + adapter yetenek bildirimi. Ertelenmişler: cache GC, sidebar hata durumu, PWA statik varlık auth (D), dokunmatik tile aksiyonları (D).
```

- [ ] **Step 3: Son doğrulama + commit** — `npm run build && npm test` yeşil; `git status` yalnız bu 3 dosya.

```bash
git add README.md CLAUDE.md .env.example
git commit -m "docs: Dilim C1 durumu — kota yönetimi + üretim hattı kullanımı"
```

---

## Doğrulama Özeti

| Kontrol | Komut | Beklenen |
|---|---|---|
| Tüm testler | `npm test` | ~101 - 7 (silinen generation) + ~28 yeni ≈ 120+ PASS |
| Build | `npm run build` | Hatasız |
| Headless smoke | Task 7 Step 1 | limit→paused→resume→done + cache 5/5 + regenerate |
| src/core | `git diff main -- src/` | Boş |
