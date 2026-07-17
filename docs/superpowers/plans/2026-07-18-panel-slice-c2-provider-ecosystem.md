# Dilim C2 — Sağlayıcı Ekosistemi Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TTS'i tek sağlayıcıdan takılabilir ekosisteme taşımak: OpenAI-uyumlu endpoint + Piper lokal adapter'ları, `/settings` ayarlar ekranı, DB-tabanlı sağlayıcı-bazlı ses havuzu, adapter yetenek bildirimi (stil düşürme).

**Architecture:** Yeni `tts_connections` (adlandırılmış OpenAI-uyumlu bağlantılar) ve `voices` (sağlayıcı-bazlı havuz) tabloları; `src/core/tts/` altına iki yeni saf adapter (config constructor'dan, DB bilmez); `adapterFromSettings` fabrikası genişler; stil desteği sağlayıcı adından türetilir ve `planChapter` tek kaynaktır (hash + gönderilen istek birlikte stilsizleşir); `/settings` sayfası + `/api/settings|connections|voices` rotaları.

**Tech Stack:** Next.js 15 App Router, Drizzle + better-sqlite3, zod, vitest (ağsız/exe'siz: fetch stub + süreç stub + `createDb(':memory:')`), saf CSS token sistemi.

**Spec:** `docs/superpowers/specs/2026-07-17-panel-slice-c2-provider-ecosystem-design.md`

## Global Constraints

- Tüm UI metinleri ve hata mesajları **Türkçe**; Türkçe karakterler (ö, ü, ç, ğ, ş, İ, ı) ve U+2019 (') / U+2022 (•) birebir korunur — ASCII'ye düzleştirme YASAK.
- `src/core` için İZİNLİ değişiklikler yalnız şunlar: `types.ts`'e opsiyonel `capabilities` alanı; `gemini.ts` ve `mock.ts`'e birer `capabilities` satırı; YENİ dosyalar `src/core/tts/openai.ts`, `src/core/tts/piper.ts`, `src/core/audio/wav-info.ts`. Başka core değişikliği YASAK; mevcut çekirdek testler değişmeden yeşil kalmalı.
- Rezerve sağlayıcı adları: `gemini`, `piper`, `mock`, `openai`. Bağlantı slug'ı: `^[a-z0-9-]{2,32}$`.
- Hash formülü DEĞİŞMEZ: `provider|model|voice|style|tags(,)|language|text` (sha256). Stil desteklemeyen sağlayıcıda style/tags plana hiç girmez (undefined) — hash de istek de stilsiz.
- Stil desteği kuralı (tek kaynak `supportsStyle(provider)`): yalnız `gemini` ve `mock` stilli; `piper` ve tüm bağlantılar stilsiz.
- Anahtar maskesi: `••••` + son 4 karakter; `•` içeren bir değer ASLA settings'e yazılmaz.
- Testler ağa çıkmaz, gerçek exe çalıştırmaz; yeni bağımlılık eklenmez (`package.json` dependencies değişmez).
- Her task sonunda `npm test` tam suite yeşil; commit mesajları Türkçe, gövde sonunda: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Şema 0003 (tts_connections + voices + tohum) ve connections/voices servisleri

**Files:**
- Modify: `lib/db/schema.ts` (iki tablo eklenir)
- Create: `drizzle/0003_c2_providers.sql` (drizzle-kit üretir; tohum SQL'i elle eklenir)
- Modify: `lib/services/settings.ts` (`deleteSetting` eklenir)
- Create: `lib/services/connections.ts`
- Create: `lib/services/voices.ts`
- Test: `tests/panel/connections-voices.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` (`lib/services/settings.ts`), `newId` (`lib/id.ts`), `Db` (`lib/db/client.ts`).
- Produces (sonraki task'lar bunlara güvenir):
  - `deleteSetting(db: Db, key: string): void`
  - `listConnections(db): ConnectionRow[]` · `getConnection(db, id): ConnectionRow | undefined` · `createConnection(db, {id, label?, baseUrl, apiKey?, model}): ConnectionRow` · `deleteConnection(db, id): void` · `RESERVED_PROVIDERS: string[]`
  - `listVoices(db, provider): VoiceRow[]` · `addVoice(db, {provider, voice, gender?, tone?, path?}): VoiceRow` · `addPiperModel(db, path): VoiceRow` · `addOpenAiDefaults(db, provider): number` · `updateVoice(db, id, {gender?, tone?}): VoiceRow` · `deleteVoice(db, id): void` · `OPENAI_DEFAULT_VOICES: string[]`
  - `ConnectionRow = typeof ttsConnections.$inferSelect`, `VoiceRow = typeof voices.$inferSelect`

- [ ] **Step 1: Failing test yaz** — `tests/panel/connections-voices.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { getSetting, setSetting, deleteSetting } from '@/lib/services/settings';
import { createConnection, deleteConnection, getConnection, listConnections } from '@/lib/services/connections';
import { OPENAI_DEFAULT_VOICES, addOpenAiDefaults, addPiperModel, addVoice, deleteVoice, listVoices, updateVoice } from '@/lib/services/voices';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('migration tohumu', () => {
  test('gemini havuzu 8 sesle tohumlanır, ilk ses Charon', () => {
    const pool = listVoices(db, 'gemini');
    expect(pool).toHaveLength(8);
    expect(pool[0].voice).toBe('Charon');
    expect(pool[0].gender).toBe('male');
    expect(pool.filter((v) => v.gender === 'female')).toHaveLength(2);
  });
});

describe('connections', () => {
  test('oluştur/listele/sil; slug ve URL doğrulanır', () => {
    const c = createConnection(db, { id: 'alltalk-lokal', label: 'AllTalk', baseUrl: 'http://localhost:8000/v1', model: 'tts-1' });
    expect(c.id).toBe('alltalk-lokal');
    expect(listConnections(db)).toHaveLength(1);
    expect(getConnection(db, 'alltalk-lokal')?.model).toBe('tts-1');
    deleteConnection(db, 'alltalk-lokal');
    expect(listConnections(db)).toHaveLength(0);
  });
  test('geçersiz slug, rezerve ad, mükerrer ad, bozuk URL, boş model → Türkçe hata', () => {
    expect(() => createConnection(db, { id: 'Büyük Harf', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/küçük harf/);
    expect(() => createConnection(db, { id: 'openai', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/rezerve/);
    createConnection(db, { id: 'ayni', baseUrl: 'http://x/v1', model: 'm' });
    expect(() => createConnection(db, { id: 'ayni', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/zaten var/);
    expect(() => createConnection(db, { id: 'bozuk-url', baseUrl: 'localhost', model: 'm' })).toThrow(/URL/);
    expect(() => createConnection(db, { id: 'bos-model', baseUrl: 'http://x/v1', model: ' ' })).toThrow(/model/);
  });
  test('silince ses havuzu temizlenir; aktif sağlayıcı buysa provider ayarı sıfırlanır', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'm' });
    addVoice(db, { provider: 'sunucum', voice: 'alloy' });
    setSetting(db, 'provider', 'sunucum');
    deleteConnection(db, 'sunucum');
    expect(listVoices(db, 'sunucum')).toHaveLength(0);
    expect(getSetting(db, 'provider')).toBeUndefined();
  });
});

describe('voices', () => {
  test('ekle/güncelle/sil; aynı sağlayıcıda mükerrer ses reddedilir', () => {
    const v = addVoice(db, { provider: 'gemini', voice: 'Zephyr', gender: 'female', tone: 'nazik' });
    expect(listVoices(db, 'gemini')).toHaveLength(9);
    expect(() => addVoice(db, { provider: 'gemini', voice: 'Zephyr' })).toThrow(/zaten/);
    const u = updateVoice(db, v.id, { tone: 'sert' });
    expect(u.tone).toBe('sert');
    deleteVoice(db, v.id);
    expect(listVoices(db, 'gemini')).toHaveLength(8);
    expect(() => updateVoice(db, 'voc_yok', { tone: 'x' })).toThrow(/bulunamadı/);
  });
  test('geçersiz gender ve boş voice reddedilir', () => {
    expect(() => addVoice(db, { provider: 'gemini', voice: 'X', gender: 'robot' })).toThrow(/cinsiyet/i);
    expect(() => addVoice(db, { provider: 'gemini', voice: '  ' })).toThrow(/ses adı/i);
  });
  test('addPiperModel: ad .onnx dosya adından türer; .onnx dışı reddedilir', () => {
    const v = addPiperModel(db, 'C:\\modeller\\tr_TR-fahrettin-medium.onnx');
    expect(v.provider).toBe('piper');
    expect(v.voice).toBe('tr_TR-fahrettin-medium');
    expect(v.path).toBe('C:\\modeller\\tr_TR-fahrettin-medium.onnx');
    expect(() => addPiperModel(db, 'C:\\x\\ses.bin')).toThrow(/onnx/i);
  });
  test('addOpenAiDefaults: resmî sesler eklenir, mevcutlar atlanır', () => {
    createConnection(db, { id: 'bulut', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' });
    addVoice(db, { provider: 'bulut', voice: 'alloy' });
    const n = addOpenAiDefaults(db, 'bulut');
    expect(n).toBe(OPENAI_DEFAULT_VOICES.length - 1);
    expect(listVoices(db, 'bulut')).toHaveLength(OPENAI_DEFAULT_VOICES.length);
  });
});

describe('deleteSetting', () => {
  test('ayarı siler; olmayan anahtar sorun değil', () => {
    setSetting(db, 'k', 'v');
    deleteSetting(db, 'k');
    expect(getSetting(db, 'k')).toBeUndefined();
    deleteSetting(db, 'k');
  });
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula** — `npm test -- tests/panel/connections-voices.test.ts` → modül bulunamadı hataları.

- [ ] **Step 3: Şemayı ekle** — `lib/db/schema.ts` sonuna (import satırına `uniqueIndex` ekle: `import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';`):

```ts
export const ttsConnections = sqliteTable('tts_connections', {
  id: text('id').primaryKey(), // kullanıcı slug'ı (^[a-z0-9-]{2,32}$); kota/cache/ses kimliklerinde sağlayıcı adı
  label: text('label').notNull().default(''),
  baseUrl: text('base_url').notNull(), // "/v1" dahil, ör. http://localhost:8000/v1
  apiKey: text('api_key'),             // null = anahtarsız lokal sunucu
  model: text('model').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const voices = sqliteTable('voices', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // gemini | piper | <bağlantı slug'ı>
  voice: text('voice').notNull(),
  gender: text('gender').notNull().default(''), // male|female|'' (bilinmiyor)
  tone: text('tone').notNull().default(''),
  path: text('path'), // yalnız piper: .onnx dosya yolu
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('voices_provider_voice').on(t.provider, t.voice)]);
```

- [ ] **Step 4: Migration üret + tohumu ekle** — Çalıştır: `npm run db:generate -- --name c2_providers`. `drizzle/0003_c2_providers.sql` oluşur (iki CREATE TABLE + CREATE UNIQUE INDEX). Dosyanın SONUNA şunu ekle (Türkçe karakterleri birebir koru):

```sql
--> statement-breakpoint
INSERT INTO `voices` (`id`,`provider`,`voice`,`gender`,`tone`,`path`,`created_at`) VALUES
('voc_seed_01','gemini','Charon','male','olgun, anlatıcı',NULL,0),
('voc_seed_02','gemini','Iapetus','male','derin',NULL,0),
('voc_seed_03','gemini','Puck','male','genç, enerjik',NULL,0),
('voc_seed_04','gemini','Algenib','male','sert',NULL,0),
('voc_seed_05','gemini','Algieba','male','yumuşak',NULL,0),
('voc_seed_06','gemini','Schedar','male','ölçülü',NULL,0),
('voc_seed_07','gemini','Kore','female','bilge, sakin',NULL,0),
('voc_seed_08','gemini','Leda','female','genç, canlı',NULL,0);
```

Not: `voc_seed_01..08` sırası havuz sırasıdır (Charon ilk — varsayılan anlatıcı geriye uyumu). `drizzle/meta/_journal.json`'a girdiyi drizzle-kit kendisi ekler; elle düzenleme.

- [ ] **Step 5: settings.ts'e deleteSetting ekle**:

```ts
export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
```

- [ ] **Step 6: `lib/services/connections.ts` yaz**:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ttsConnections, voices } from '../db/schema';
import { deleteSetting, getSetting } from './settings';

export type ConnectionRow = typeof ttsConnections.$inferSelect;

export const RESERVED_PROVIDERS = ['gemini', 'piper', 'mock', 'openai'];
const SLUG_RE = /^[a-z0-9-]{2,32}$/;

export function listConnections(db: Db): ConnectionRow[] {
  return db.select().from(ttsConnections).orderBy(asc(ttsConnections.createdAt)).all();
}

export function getConnection(db: Db, id: string): ConnectionRow | undefined {
  return db.select().from(ttsConnections).where(eq(ttsConnections.id, id)).get();
}

export function createConnection(db: Db, c: { id: string; label?: string; baseUrl: string; apiKey?: string; model: string }): ConnectionRow {
  if (!SLUG_RE.test(c.id)) throw new Error('Geçersiz bağlantı adı: küçük harf/rakam/tire, 2-32 karakter (ör. "alltalk-lokal")');
  if (RESERVED_PROVIDERS.includes(c.id)) throw new Error(`"${c.id}" rezerve bir sağlayıcı adı — başka bir ad seçin`);
  if (getConnection(db, c.id)) throw new Error('Bu adla bir bağlantı zaten var');
  try { new URL(c.baseUrl); } catch { throw new Error('Geçersiz URL (ör. http://localhost:8000/v1)'); }
  if (!c.model.trim()) throw new Error('model gerekli (ör. tts-1)');
  const now = Date.now();
  const row: ConnectionRow = {
    id: c.id, label: c.label?.trim() || c.id, baseUrl: c.baseUrl.trim(),
    apiKey: c.apiKey?.trim() || null, model: c.model.trim(), createdAt: now, updatedAt: now,
  };
  db.insert(ttsConnections).values(row).run();
  return row;
}

export function deleteConnection(db: Db, id: string): void {
  db.delete(voices).where(eq(voices.provider, id)).run(); // havuzu temizle
  db.delete(ttsConnections).where(eq(ttsConnections.id, id)).run();
  // Aktif sağlayıcı silinen bağlantıysa varsayılana (gemini) düşür.
  if (getSetting(db, 'provider') === id) deleteSetting(db, 'provider');
}
```

- [ ] **Step 7: `lib/services/voices.ts` yaz**:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { voices } from '../db/schema';
import { newId } from '../id';

export type VoiceRow = typeof voices.$inferSelect;

export const OPENAI_DEFAULT_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
const GENDERS = ['male', 'female', ''];

export function listVoices(db: Db, provider: string): VoiceRow[] {
  return db.select().from(voices).where(eq(voices.provider, provider))
    .orderBy(asc(voices.createdAt), asc(voices.id)).all();
}

export function addVoice(db: Db, v: { provider: string; voice: string; gender?: string; tone?: string; path?: string }): VoiceRow {
  const voice = v.voice?.trim();
  if (!voice) throw new Error('Ses adı gerekli');
  const gender = v.gender ?? '';
  if (!GENDERS.includes(gender)) throw new Error('Geçersiz cinsiyet (male, female veya boş)');
  if (db.select().from(voices).where(eq(voices.provider, v.provider)).all().some((r) => r.voice === voice))
    throw new Error('Bu ses zaten havuzda');
  const row: VoiceRow = {
    id: newId('voc'), provider: v.provider, voice, gender,
    tone: v.tone?.trim() ?? '', path: v.path ?? null, createdAt: Date.now(),
  };
  db.insert(voices).values(row).run();
  return row;
}

// Piper: ses adı .onnx dosya adından türer (ör. tr_TR-fahrettin-medium).
export function addPiperModel(db: Db, path: string): VoiceRow {
  const p = path.trim();
  if (!/\.onnx$/i.test(p)) throw new Error('Piper modeli .onnx dosyası olmalı');
  const base = p.split(/[\\/]/).pop()!;
  return addVoice(db, { provider: 'piper', voice: base.replace(/\.onnx$/i, ''), path: p });
}

// Resmî OpenAI seslerini ekler; mevcut olanları atlar. Eklenen sayıyı döndürür.
export function addOpenAiDefaults(db: Db, provider: string): number {
  const existing = new Set(listVoices(db, provider).map((v) => v.voice));
  let n = 0;
  for (const voice of OPENAI_DEFAULT_VOICES) {
    if (existing.has(voice)) continue;
    addVoice(db, { provider, voice });
    n++;
  }
  return n;
}

export function updateVoice(db: Db, id: string, patch: { gender?: string; tone?: string }): VoiceRow {
  const row = db.select().from(voices).where(eq(voices.id, id)).get();
  if (!row) throw new Error('Ses bulunamadı');
  if (patch.gender !== undefined && !GENDERS.includes(patch.gender)) throw new Error('Geçersiz cinsiyet (male, female veya boş)');
  db.update(voices).set({
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.tone !== undefined ? { tone: patch.tone.trim() } : {}),
  }).where(eq(voices.id, id)).run();
  return db.select().from(voices).where(eq(voices.id, id)).get()!;
}

export function deleteVoice(db: Db, id: string): void {
  db.delete(voices).where(eq(voices.id, id)).run();
}
```

- [ ] **Step 8: Testleri çalıştır, PASS doğrula** — `npm test -- tests/panel/connections-voices.test.ts` → hepsi yeşil; sonra `npm test` tam suite (mevcut 123 test etkilenmemeli).

- [ ] **Step 9: Commit**

```bash
git add lib/db/schema.ts drizzle/ lib/services/settings.ts lib/services/connections.ts lib/services/voices.ts tests/panel/connections-voices.test.ts
git commit -m "feat(panel): şema 0003 — tts_connections + voices (gemini tohumlu) + servisler"
```

---

### Task 2: Core adapter'lar — OpenAiCompatAdapter, PiperAdapter, wav-info, capabilities

**Files:**
- Modify: `src/core/types.ts` (opsiyonel `capabilities` alanı)
- Modify: `src/core/tts/gemini.ts`, `src/core/tts/mock.ts` (birer `capabilities` satırı)
- Create: `src/core/audio/wav-info.ts`
- Create: `src/core/tts/openai.ts`
- Create: `src/core/tts/piper.ts`
- Test: `tests/core/wav-info.test.ts`, `tests/core/openai-adapter.test.ts`, `tests/core/piper-adapter.test.ts`

**Interfaces:**
- Consumes: `TtsAdapter`, `TtsResult`, `TtsSegmentRequest` (`src/core/types.ts`); `pcmToWav`, `makeSilencePcm` (test fikstürü için).
- Produces:
  - `TtsCapabilities { style: boolean }`; `TtsAdapter.capabilities?: TtsCapabilities`
  - `wavDurationMs(wav: Buffer): number`
  - `new OpenAiCompatAdapter({ id, baseUrl, apiKey?, model })` — `id` = bağlantı slug'ı
  - `new PiperAdapter({ exePath, models: Record<voiceName, modelPath>, runProcess? })`
  - `RunProcess = (exe: string, args: string[], stdinText: string) => Promise<void>`

- [ ] **Step 1: Failing testleri yaz**

`tests/core/wav-info.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav } from '@/src/core/audio/wav';
import { wavDurationMs } from '@/src/core/audio/wav-info';

describe('wavDurationMs', () => {
  test('44 baytlık standart başlıktan süreyi okur', () => {
    expect(wavDurationMs(pcmToWav(makeSilencePcm(500)))).toBe(500);
    expect(wavDurationMs(pcmToWav(makeSilencePcm(1234)))).toBe(1234);
  });
  test('RIFF olmayan veya kısa buffer → 0', () => {
    expect(wavDurationMs(Buffer.from('bu bir wav değil'))).toBe(0);
    expect(wavDurationMs(Buffer.alloc(4))).toBe(0);
  });
});
```

`tests/core/openai-adapter.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeSilencePcm, pcmToWav } from '@/src/core/audio/wav';
import { OpenAiCompatAdapter } from '@/src/core/tts/openai';

const WAV = pcmToWav(makeSilencePcm(400));
const REQ = { text: 'Merhaba dünya', voice: { provider: 'sunucum', providerVoice: 'alloy' }, language: 'tr-TR' };

afterEach(() => vi.unstubAllGlobals());

describe('OpenAiCompatAdapter', () => {
  test('doğru URL/gövde/başlıkla POST eder; wav süresi ve chars maliyeti döner', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(WAV); });
    const a = new OpenAiCompatAdapter({ id: 'sunucum', baseUrl: 'http://localhost:8000/v1/', apiKey: 'gizli', model: 'tts-1' });
    expect(a.id).toBe('sunucum');
    expect(a.capabilities).toEqual({ style: false });
    const res = await a.synthesize(REQ);
    expect(captured!.url).toBe('http://localhost:8000/v1/audio/speech'); // sondaki / temizlenir
    const body = JSON.parse(String(captured!.init.body));
    expect(body).toEqual({ model: 'tts-1', voice: 'alloy', input: 'Merhaba dünya', response_format: 'wav' });
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer gizli');
    expect(res.format).toBe('wav');
    expect(res.durationMs).toBe(400);
    expect(res.cost).toEqual({ unit: 'chars', amount: 'Merhaba dünya'.length, usd: 0 });
  });
  test('anahtarsız bağlantıda Authorization başlığı yok', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { headers = init.headers as Record<string, string>; return new Response(WAV); });
    await new OpenAiCompatAdapter({ id: 's', baseUrl: 'http://x/v1', model: 'm' }).synthesize(REQ);
    expect(headers.Authorization).toBeUndefined();
  });
  test('HTTP hatası Türkçe mesajla fırlar (durum + gövde özeti)', async () => {
    vi.stubGlobal('fetch', async () => new Response('model not found', { status: 404 }));
    await expect(new OpenAiCompatAdapter({ id: 's', baseUrl: 'http://x/v1', model: 'm' }).synthesize(REQ))
      .rejects.toThrow(/HTTP 404.*model not found/s);
  });
});
```

`tests/core/piper-adapter.test.ts`:

```ts
import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav } from '@/src/core/audio/wav';
import { PiperAdapter, type RunProcess } from '@/src/core/tts/piper';

const REQ = { text: 'İyi akşamlar', voice: { provider: 'piper', providerVoice: 'tr_TR-fahrettin-medium' }, language: 'tr-TR' };

describe('PiperAdapter', () => {
  test('doğru argümanlarla süreci çağırır; stdin metni; wav geçici dosyadan okunur ve silinir', async () => {
    let captured: { exe: string; args: string[]; stdin: string } | null = null;
    const run: RunProcess = async (exe, args, stdin) => {
      captured = { exe, args, stdin };
      await writeFile(args[args.indexOf('--output_file') + 1], pcmToWav(makeSilencePcm(300)));
    };
    const a = new PiperAdapter({ exePath: 'C:\\piper\\piper.exe', models: { 'tr_TR-fahrettin-medium': 'C:\\m\\tr.onnx' }, runProcess: run });
    expect(a.capabilities).toEqual({ style: false });
    const res = await a.synthesize(REQ);
    expect(captured!.exe).toBe('C:\\piper\\piper.exe');
    expect(captured!.args.slice(0, 2)).toEqual(['--model', 'C:\\m\\tr.onnx']);
    expect(captured!.stdin).toBe('İyi akşamlar');
    expect(res.durationMs).toBe(300);
    expect(res.cost).toEqual({ unit: 'chars', amount: 'İyi akşamlar'.length, usd: 0 });
  });
  test('tanımsız ses adı → Türkçe hata, süreç çağrılmaz', async () => {
    const a = new PiperAdapter({ exePath: 'p', models: {}, runProcess: async () => { throw new Error('çağrılmamalı'); } });
    await expect(a.synthesize(REQ)).rejects.toThrow(/tanımsız/);
  });
  test('süreç hatası yayılır', async () => {
    const a = new PiperAdapter({ exePath: 'p', models: { 'tr_TR-fahrettin-medium': 'x.onnx' }, runProcess: async () => { throw new Error('piper çıkış kodu 1'); } });
    await expect(a.synthesize(REQ)).rejects.toThrow(/çıkış kodu 1/);
  });
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula** — `npm test -- tests/core/wav-info.test.ts tests/core/openai-adapter.test.ts tests/core/piper-adapter.test.ts` → modül bulunamadı.

- [ ] **Step 3: types.ts + mevcut adapter'lara capabilities** — `src/core/types.ts` son satırlarını şu hale getir:

```ts
export interface TtsCapabilities { style: boolean }
export interface TtsAdapter { readonly id: string; readonly capabilities?: TtsCapabilities; synthesize(req: TtsSegmentRequest): Promise<TtsResult>; }
```

`src/core/tts/gemini.ts` — `readonly model: string;` satırının altına: `readonly capabilities: TtsCapabilities = { style: true };` (import'a `TtsCapabilities` ekle).
`src/core/tts/mock.ts` — `readonly id = 'mock';` satırının altına: `readonly capabilities: TtsCapabilities = { style: true };` (import'a `TtsCapabilities` ekle).

- [ ] **Step 4: `src/core/audio/wav-info.ts` yaz**:

```ts
// RIFF/WAVE başlığından süre: fmt chunk'ındaki byteRate + data chunk boyutu.
// Tanınmayan/bozuk girdi için 0 döner (fırlatmaz) — süre bilgisi kritik değil.
export function wavDurationMs(wav: Buffer): number {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let off = 12, byteRate = 0, dataSize = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 20 <= wav.length) byteRate = wav.readUInt32LE(off + 16);
    if (id === 'data') { dataSize = Math.min(size, wav.length - off - 8); break; }
    off += 8 + size + (size % 2); // chunk'lar 2 bayta hizalanır
  }
  return byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 0;
}
```

- [ ] **Step 5: `src/core/tts/openai.ts` yaz**:

```ts
import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
import { wavDurationMs } from '../audio/wav-info.js';

export interface OpenAiCompatConfig { id: string; baseUrl: string; apiKey?: string | null; model: string }

// OpenAI-uyumlu /audio/speech endpoint'i (OpenAI, AllTalk, openedai-speech, LocalAI...).
// baseUrl "/v1" dahil girilir (ör. http://localhost:8000/v1). Retry yok: lokal sunucular
// hızlı-başarısız; Gemini'deki retry oradaki preview kırılganlığına özeldi.
export class OpenAiCompatAdapter implements TtsAdapter {
  readonly id: string;
  readonly capabilities: TtsCapabilities = { style: false };
  constructor(private readonly cfg: OpenAiCompatConfig) { this.id = cfg.id; }

  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model: this.cfg.model, voice: req.voice.providerVoice, input: req.text, response_format: 'wav' }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`TTS sunucusu hata döndürdü (HTTP ${res.status}): ${body || 'gövde yok'}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, format: 'wav', durationMs: wavDurationMs(audio), cost: { unit: 'chars', amount: req.text.length, usd: 0 } };
  }
}
```

- [ ] **Step 6: `src/core/tts/piper.ts` yaz**:

```ts
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
import { wavDurationMs } from '../audio/wav-info.js';

export type RunProcess = (exe: string, args: string[], stdinText: string) => Promise<void>;

const defaultRun: RunProcess = (exe, args, stdinText) =>
  new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper çıkış kodu ${code}: ${err.slice(-200)}`))));
    p.stdin.end(stdinText, 'utf8');
  });

export interface PiperConfig { exePath: string; models: Record<string, string>; runProcess?: RunProcess }

// Piper lokal TTS: segment başına bir süreç; metin stdin'den, wav geçici dosyadan.
// runProcess enjekte edilebilir — testler gerçek exe olmadan stub'lar.
export class PiperAdapter implements TtsAdapter {
  readonly id = 'piper';
  readonly capabilities: TtsCapabilities = { style: false };
  constructor(private readonly cfg: PiperConfig) {}

  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const modelPath = this.cfg.models[req.voice.providerVoice];
    if (!modelPath) throw new Error(`Piper ses modeli tanımsız: "${req.voice.providerVoice}" — Ayarlar'dan ekleyin`);
    const tmp = join(tmpdir(), `piper-${randomUUID()}.wav`);
    try {
      await (this.cfg.runProcess ?? defaultRun)(this.cfg.exePath, ['--model', modelPath, '--output_file', tmp], req.text);
      const audio = await readFile(tmp);
      return { audio, format: 'wav', durationMs: wavDurationMs(audio), cost: { unit: 'chars', amount: req.text.length, usd: 0 } };
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }
}
```

- [ ] **Step 7: Testleri çalıştır, PASS doğrula** — üç yeni dosya + `npm test` tam suite (çekirdek 23 test dahil hepsi yeşil).

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/tts/gemini.ts src/core/tts/mock.ts src/core/audio/wav-info.ts src/core/tts/openai.ts src/core/tts/piper.ts tests/core/
git commit -m "feat(core): OpenAI-uyumlu + Piper TTS adapter'ları, wav süre okuyucu, yetenek bildirimi"
```

---

### Task 3: adapterFromSettings genişletme + gemini_api_key DB fallback + activeProvider model çözümü

**Files:**
- Modify: `lib/services/generation.ts`
- Modify: `lib/services/quota.ts` (`activeProvider` bağlantı modelini çözer)
- Modify: `lib/services/annotation.ts` (`llmAdapterFromSettings` anahtar kaynağı)
- Test: `tests/panel/tts-factory.test.ts` (yeni)

**Interfaces:**
- Consumes: Task 1 servisleri (`getConnection`, `listVoices`), Task 2 adapter'ları.
- Produces:
  - `geminiApiKey(db: Db): string | undefined` — `getSetting('gemini_api_key') ?? process.env.GEMINI_API_KEY`
  - `supportsStyle(provider: string): boolean` — yalnız `gemini`/`mock` true (Task 4 ve UI bunu kullanır)
  - `adapterFromSettings(db)` — mock | gemini | piper | <slug> çözer; Türkçe hatalar
  - `activeProvider(db)` — bağlantı sağlayıcısında `model` bağlantı satırından gelir

- [ ] **Step 1: Failing test yaz** — `tests/panel/tts-factory.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { setSetting } from '@/lib/services/settings';
import { createConnection } from '@/lib/services/connections';
import { addPiperModel } from '@/lib/services/voices';
import { activeProvider } from '@/lib/services/quota';
import { adapterFromSettings, geminiApiKey, supportsStyle } from '@/lib/services/generation';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import { OpenAiCompatAdapter } from '@/src/core/tts/openai';
import { PiperAdapter } from '@/src/core/tts/piper';

let db: Db;
const envKey = process.env.GEMINI_API_KEY;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => { if (envKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = envKey; });

describe('supportsStyle', () => {
  test('yalnız gemini ve mock stilli', () => {
    expect(supportsStyle('gemini')).toBe(true);
    expect(supportsStyle('mock')).toBe(true);
    expect(supportsStyle('piper')).toBe(false);
    expect(supportsStyle('alltalk-lokal')).toBe(false);
  });
});

describe('geminiApiKey', () => {
  test('DB önce, env fallback', () => {
    process.env.GEMINI_API_KEY = 'env-anahtar';
    expect(geminiApiKey(db)).toBe('env-anahtar');
    setSetting(db, 'gemini_api_key', 'db-anahtar');
    expect(geminiApiKey(db)).toBe('db-anahtar');
    delete process.env.GEMINI_API_KEY;
    expect(geminiApiKey(db)).toBe('db-anahtar');
  });
});

describe('adapterFromSettings', () => {
  test('mock ve gemini (DB anahtarıyla) kurulur', () => {
    setSetting(db, 'provider', 'mock');
    expect(adapterFromSettings(db)).toBeInstanceOf(MockAdapter);
    delete process.env.GEMINI_API_KEY;
    setSetting(db, 'provider', 'gemini');
    expect(() => adapterFromSettings(db)).toThrow(/anahtar/i);
    setSetting(db, 'gemini_api_key', 'db-anahtar');
    expect(adapterFromSettings(db)).toBeInstanceOf(GeminiAdapter);
  });
  test('bağlantı slug’ı → OpenAiCompatAdapter (id = slug)', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'tts-1' });
    setSetting(db, 'provider', 'sunucum');
    const a = adapterFromSettings(db);
    expect(a).toBeInstanceOf(OpenAiCompatAdapter);
    expect(a.id).toBe('sunucum');
  });
  test('bilinmeyen sağlayıcı → Türkçe hata', () => {
    setSetting(db, 'provider', 'yok-boyle');
    expect(() => adapterFromSettings(db)).toThrow(/Bilinmeyen TTS sağlayıcısı/);
  });
  test('piper: exe ve model şart; tamsa PiperAdapter', () => {
    setSetting(db, 'provider', 'piper');
    expect(() => adapterFromSettings(db)).toThrow(/exe/i);
    setSetting(db, 'piper_exe', 'C:\\piper\\piper.exe');
    expect(() => adapterFromSettings(db)).toThrow(/model/i);
    addPiperModel(db, 'C:\\m\\tr_TR-fahrettin-medium.onnx');
    expect(adapterFromSettings(db)).toBeInstanceOf(PiperAdapter);
  });
});

describe('activeProvider', () => {
  test('bağlantı sağlayıcısında model bağlantıdan gelir; piper modeli boş', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'kokoro' });
    setSetting(db, 'provider', 'sunucum');
    expect(activeProvider(db)).toEqual({ name: 'sunucum', model: 'kokoro' });
    setSetting(db, 'provider', 'piper');
    expect(activeProvider(db)).toEqual({ name: 'piper', model: '' });
  });
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula** — `npm test -- tests/panel/tts-factory.test.ts`.

- [ ] **Step 3: `lib/services/generation.ts`'i şu hale getir** (dosyanın tamamı):

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders } from '../db/schema';
import { getSetting } from './settings';
import { activeProvider } from './quota';
import { getConnection } from './connections';
import { listVoices } from './voices';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import { OpenAiCompatAdapter } from '@/src/core/tts/openai';
import { PiperAdapter } from '@/src/core/tts/piper';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;

// Gemini anahtarı: ayarlar (DB) → env. TTS ve LLM aynı anahtarı paylaşır.
export function geminiApiKey(db: Db): string | undefined {
  return getSetting(db, 'gemini_api_key') ?? process.env.GEMINI_API_KEY ?? undefined;
}

// Stil desteği sağlayıcı ADINDAN belirlenir (adapter kurmadan — preflight anahtarsız da çalışmalı).
export function supportsStyle(provider: string): boolean {
  return provider === 'gemini' || provider === 'mock';
}

// Ayarlar (settings) → env → varsayılan sırasıyla aktif sağlayıcının adapter'ını kurar.
export function adapterFromSettings(db: Db): TtsAdapter {
  const { name: provider, model } = activeProvider(db);
  if (provider === 'mock') return new MockAdapter();
  if (provider === 'gemini') {
    const key = geminiApiKey(db);
    if (!key) throw new Error('Gemini API anahtarı yok — Ayarlar’dan girin veya .env GEMINI_API_KEY tanımlayın');
    return new GeminiAdapter(key, model || undefined);
  }
  if (provider === 'piper') {
    const exe = getSetting(db, 'piper_exe');
    if (!exe) throw new Error('Piper exe yolu tanımsız — Ayarlar’dan girin');
    const models: Record<string, string> = {};
    for (const v of listVoices(db, 'piper')) if (v.path) models[v.voice] = v.path;
    if (Object.keys(models).length === 0) throw new Error('Piper ses modeli yok — Ayarlar’dan .onnx ekleyin');
    return new PiperAdapter({ exePath: exe, models });
  }
  const conn = getConnection(db, provider);
  if (!conn) throw new Error(`Bilinmeyen TTS sağlayıcısı: "${provider}" — Ayarlar’dan bağlantı tanımlayın`);
  return new OpenAiCompatAdapter({ id: conn.id, baseUrl: conn.baseUrl, apiKey: conn.apiKey, model: conn.model });
}

export function listRenders(db: Db, chapterId: string): RenderRow[] {
  return db.select().from(renders).where(eq(renders.chapterId, chapterId)).orderBy(desc(renders.createdAt)).all();
}
```

(Not: `’` = U+2019 sağ tek tırnak — kaynakta gerçek karakter olarak yazılır, escape değil.)

- [ ] **Step 4: `lib/services/quota.ts` activeProvider'ı güncelle** (import'lara `ttsConnections` ve `eq` zaten var; şemadan `ttsConnections` ekle):

```ts
import { ttsConnections, ttsCalls } from '../db/schema';
...
export function activeProvider(db: Db): { name: string; model: string } {
  const name = getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini';
  if (name === 'gemini' || name === 'mock')
    return { name, model: getSetting(db, 'model') ?? process.env.TTS_MODEL ?? '' };
  if (name === 'piper') return { name, model: '' };
  // OpenAI-uyumlu bağlantı: model bağlantı satırından (servis importu yok — döngü riski taşımasın diye tabloya doğrudan bakılır).
  const conn = db.select().from(ttsConnections).where(eq(ttsConnections.id, name)).get();
  return { name, model: conn?.model ?? '' };
}
```

- [ ] **Step 5: `lib/services/annotation.ts` anahtar kaynağını değiştir** — `llmAdapterFromSettings` içinde:

```ts
// ESKİ:
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil (.env)');
// YENİ:
  const key = geminiApiKey(db);
  if (!key) throw new Error('Gemini API anahtarı yok — Ayarlar’dan girin veya .env GEMINI_API_KEY tanımlayın');
```

Import ekle: `import { geminiApiKey } from './generation';`

- [ ] **Step 6: Testleri çalıştır, PASS doğrula** — yeni dosya + `npm test` tam suite. Dikkat: `tests/panel/annotation.test.ts` ve `api-annotate` testleri env `GEMINI_API_KEY`'e bakan eski hata mesajını doğruluyorsa mesaj beklentisini yeni metne güncelle (davranış sözleşmesi aynı: anahtar yoksa fırlatır).

- [ ] **Step 7: Commit**

```bash
git add lib/services/generation.ts lib/services/quota.ts lib/services/annotation.ts tests/panel/tts-factory.test.ts tests/panel/annotation.test.ts tests/panel/api-annotate.test.ts
git commit -m "feat(panel): adapter fabrikası — piper + OpenAI-uyumlu bağlantılar, gemini anahtarı DB+env"
```

(Değişmeyen test dosyaları git add'e girmesin — yalnız gerçekten dokunulanlar.)

---

### Task 4: Stil düşürme — planChapter tek kaynak + preflight alanları

**Files:**
- Modify: `lib/services/preflight.ts`
- Test: `tests/panel/preflight.test.ts` (ekleme), `tests/panel/producer.test.ts` (ekleme)

**Interfaces:**
- Consumes: `supportsStyle(provider)` (Task 3).
- Produces:
  - `PlanItem` — stil desteklemeyen sağlayıcıda `style`/`tags` her zaman `undefined` (hash da böyle hesaplanır; producer plana güvendiğinden başka değişiklik GEREKMEZ).
  - `Preflight`'a iki alan: `supportsStyle: boolean; styledSegments: number`.

- [ ] **Step 1: Failing testleri yaz** — `tests/panel/preflight.test.ts`'e ekle:

```ts
import { supportsStyle } from '@/lib/services/generation'; // dosya başına import

describe('stil düşürme (yetenek bildirimi)', () => {
  test('piper: plan stilsiz; hash stilsiz formülle birebir', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'piper');
    const { script, plan } = planChapter(db, chapterId);
    expect(plan.every((p) => p.style === undefined && p.tags === undefined)).toBe(true);
    expect(plan[0].hash).toBe(segmentHash({
      provider: 'piper', model: '', voice: plan[0].voiceId,
      language: script.language, text: plan[0].text,
    }));
  });
  test('preflight: supportsStyle=false + styledSegments>0 (piper); gemini true', () => {
    const { db, chapterId } = setup();
    expect(preflightChapter(db, chapterId).supportsStyle).toBe(true);
    setSetting(db, 'provider', 'piper');
    const pf = preflightChapter(db, chapterId);
    expect(pf.supportsStyle).toBe(false);
    expect(pf.styledSegments).toBeGreaterThan(0); // fixture'da stilli segmentler var
  });
});
```

`tests/panel/producer.test.ts`'e ekle (dosyadaki mevcut setup/fake-adapter kalıbını kullan; fake adapter istekleri bir diziye kaydediyor olmalı — yoksa bu test için kaydeden küçük bir adapter tanımla):

```ts
test('stil desteklemeyen sağlayıcıda synthesize istekleri stilsiz gider', async () => {
  const { db, chapterId } = setup(); // dosyadaki mevcut kurulum yardımcısını kullan
  setSetting(db, 'provider', 'piper');
  const seen: { style?: string; tags?: string[] }[] = [];
  const spy = {
    id: 'piper',
    capabilities: { style: false },
    async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
      seen.push({ style: req.style, tags: req.tags });
      return new MockAdapter().synthesize(req);
    },
  };
  const job = enqueueJob(db, chapterId);
  await runJob(db, job.id, spy);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((r) => r.style === undefined && (r.tags === undefined || r.tags.length === 0))).toBe(true);
});
```

(Kodu dosyanın mevcut kurulum/import'larına uyarlayarak yaz; doğrulanan sözleşme: stilsiz istek + stilsiz hash. `TtsSegmentRequest`/`TtsResult` tipleri ve `MockAdapter` importları dosyada yoksa ekle.)

- [ ] **Step 2: Çalıştır, FAIL doğrula** — `npm test -- tests/panel/preflight.test.ts tests/panel/producer.test.ts`.

- [ ] **Step 3: `lib/services/preflight.ts`'i güncelle**:

`planChapter` içinde (mevcut `const { name: provider, model } = activeProvider(db);` satırından sonra):

```ts
  const styleOk = supportsStyle(provider);
  const plan = script.segments.map((seg, idx) => {
    const { cast } = resolveVoiceForSpeaker(script, seg.speaker);
    // Stil desteklemeyen sağlayıcıda stil/tag plana HİÇ girmez: istek de hash de stilsiz (tek kaynak).
    const style = styleOk ? ([cast.baseStyle, seg.style].filter(Boolean).join(', ') || undefined) : undefined;
    const tags = styleOk ? seg.tags : undefined;
    return {
      idx, text: seg.text, style, tags, voiceId: cast.voiceId, pauseAfterMs: seg.pauseAfterMs,
      hash: segmentHash({ provider, model, voice: cast.voiceId, style, tags, language: script.language, text: seg.text }),
    };
  });
```

Import ekle: `import { supportsStyle } from './generation';`

`Preflight` arayüzü ve `preflightChapter`:

```ts
export interface Preflight {
  total: number; cached: number; newCalls: number;
  supportsStyle: boolean; styledSegments: number; // supportsStyle=false && styledSegments>0 → UI bilgi notu
  quota: { provider: string; used: number; limit: number; remaining: number } | null;
  fits: boolean;
}

export function preflightChapter(db: Db, chapterId: string): Preflight {
  const { script, plan } = planChapter(db, chapterId);
  let cached = 0;
  for (const p of plan) if (db.select().from(audioCache).where(eq(audioCache.hash, p.hash)).get()) cached++;
  const newCalls = plan.length - cached;
  const { name: provider } = activeProvider(db);
  const styleOk = supportsStyle(provider);
  const styledSegments = script.segments.filter((s) => {
    const cast = script.cast.find((c) => c.characterId === s.speaker);
    return Boolean(s.style || s.tags?.length || cast?.baseStyle);
  }).length;
  const limit = quotaLimit(db, provider);
  const quota = limit == null ? null : { provider, used: usedToday(db, provider), limit, remaining: remainingToday(db, provider)! };
  return { total: plan.length, cached, newCalls, supportsStyle: styleOk, styledSegments, quota, fits: quota == null || newCalls <= quota.remaining };
}
```

- [ ] **Step 4: Testleri çalıştır, PASS doğrula** — iki dosya + `npm test` tam suite (producer/regenerate/api-generate mevcut testleri provider=mock kullanır; mock stilli olduğundan davranışları değişmez).

- [ ] **Step 5: Commit**

```bash
git add lib/services/preflight.ts tests/panel/preflight.test.ts tests/panel/producer.test.ts
git commit -m "feat(panel): yetenek bildirimi — stilsiz sağlayıcıda stil düşürme (plan + hash tek kaynak)"
```

---

### Task 5: API rotaları — /api/settings, /api/connections, /api/voices

**Files:**
- Create: `app/api/settings/route.ts`
- Create: `app/api/connections/route.ts`
- Create: `app/api/connections/[id]/route.ts`
- Create: `app/api/voices/route.ts`
- Create: `app/api/voices/[id]/route.ts`
- Test: `tests/panel/api-settings.test.ts`

**Interfaces:**
- Consumes: Task 1 servisleri, `quotaLimit` (`lib/services/quota.ts`), `deleteSetting`.
- Produces (UI Task 7 bunları çağırır):
  - `GET /api/settings` → `{ provider, model, llmProvider, llmModel, piperExe, geminiKey (maskeli|null), geminiKeySource ('db'|'env'|null), quotaLimits: Record<provider, number|null>, connections: [{id,label,baseUrl,model,hasKey}], voices: Record<provider, VoiceRow[]> }`
  - `PUT /api/settings` kısmi gövde: `{ provider?, model?, llmProvider?, llmModel?, piperExe?, geminiKey?: string|null, quotaLimits?: Record<string, number|null> }` → `{ ok: true }`
  - `GET/POST /api/connections`; `DELETE /api/connections/[id]` → 204
  - `POST /api/voices` gövde 3 biçim: `{provider, defaults:true}` | `{provider:'piper', path}` | `{provider, voice, gender?, tone?}`; `PATCH/DELETE /api/voices/[id]`

- [ ] **Step 1: Failing test yaz** — `tests/panel/api-settings.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { getSetting, setSetting } from '@/lib/services/settings';
import * as settingsRoute from '@/app/api/settings/route';
import * as connectionsRoute from '@/app/api/connections/route';
import * as connectionRoute from '@/app/api/connections/[id]/route';
import * as voicesRoute from '@/app/api/voices/route';
import * as voiceRoute from '@/app/api/voices/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

describe('GET /api/settings', () => {
  test('maskeli anahtar + kaynak + havuzlar + kota limitleri', async () => {
    setSetting(db, 'gemini_api_key', 'AIzaGizliAnahtar1234');
    const d = await (await settingsRoute.GET()).json();
    expect(d.geminiKey).toBe('••••1234');
    expect(d.geminiKeySource).toBe('db');
    expect(d.provider).toBe('gemini');
    expect(d.voices.gemini).toHaveLength(8);
    expect(d.quotaLimits.gemini).toBe(100);
    expect(d.quotaLimits.piper).toBeNull();
  });
});

describe('PUT /api/settings', () => {
  test('kısmi güncelleme; null anahtar DB kaydını siler; kota limiti yazılır/silinir', async () => {
    let res = await settingsRoute.PUT(jsonReq('PUT', { provider: 'mock', geminiKey: 'AIzaYeniAnahtar5678', quotaLimits: { gemini: 500 } }));
    expect(res.status).toBe(200);
    expect(getSetting(db, 'provider')).toBe('mock');
    expect(getSetting(db, 'gemini_api_key')).toBe('AIzaYeniAnahtar5678');
    expect(getSetting(db, 'quota_limit_gemini')).toBe('500');
    res = await settingsRoute.PUT(jsonReq('PUT', { geminiKey: null, quotaLimits: { gemini: null } }));
    expect(res.status).toBe(200);
    expect(getSetting(db, 'gemini_api_key')).toBeUndefined();
    expect(getSetting(db, 'quota_limit_gemini')).toBeUndefined();
  });
  test('maskeli değer (• içeren) asla kaydedilmez → 400', async () => {
    setSetting(db, 'gemini_api_key', 'AIzaGizliAnahtar1234');
    const res = await settingsRoute.PUT(jsonReq('PUT', { geminiKey: '••••1234' }));
    expect(res.status).toBe(400);
    expect(getSetting(db, 'gemini_api_key')).toBe('AIzaGizliAnahtar1234');
  });
  test('bilinmeyen sağlayıcı → 400', async () => {
    const res = await settingsRoute.PUT(jsonReq('PUT', { provider: 'yok-boyle' }));
    expect(res.status).toBe(400);
  });
});

describe('connections + voices rotaları', () => {
  test('bağlantı oluştur (201, anahtar sızmaz) → varsayılan sesleri ekle → sil (204)', async () => {
    const res = await connectionsRoute.POST(jsonReq('POST', { id: 'sunucum', baseUrl: 'http://x/v1', apiKey: 'cok-gizli', model: 'tts-1' }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.hasKey).toBe(true);
    expect(JSON.stringify(created)).not.toContain('cok-gizli');

    const list = await (await connectionsRoute.GET()).json();
    expect(list).toHaveLength(1);

    const dv = await (await voicesRoute.POST(jsonReq('POST', { provider: 'sunucum', defaults: true }))).json();
    expect(dv.added).toBe(9);

    const del = await connectionRoute.DELETE(jsonReq('DELETE'), ctx('sunucum'));
    expect(del.status).toBe(204);
  });
  test('rezerve slug → 400', async () => {
    const res = await connectionsRoute.POST(jsonReq('POST', { id: 'openai', baseUrl: 'http://x/v1', model: 'm' }));
    expect(res.status).toBe(400);
  });
  test('ses ekle/piper-model/patch/sil', async () => {
    const v = await (await voicesRoute.POST(jsonReq('POST', { provider: 'gemini', voice: 'Zephyr', gender: 'female' }))).json();
    expect(v.voice).toBe('Zephyr');
    const p = await (await voicesRoute.POST(jsonReq('POST', { provider: 'piper', path: 'C:\\m\\tr_TR-dfki-medium.onnx' }))).json();
    expect(p.voice).toBe('tr_TR-dfki-medium');
    const u = await (await voiceRoute.PATCH(jsonReq('PATCH', { tone: 'yumuşak' }), ctx(v.id))).json();
    expect(u.tone).toBe('yumuşak');
    const del = await voiceRoute.DELETE(jsonReq('DELETE'), ctx(v.id));
    expect(del.status).toBe(204);
    const dup = await voicesRoute.POST(jsonReq('POST', { provider: 'piper', path: 'C:\\m\\tr_TR-dfki-medium.onnx' }));
    expect(dup.status).toBe(400);
  });
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula.**

- [ ] **Step 3: `app/api/settings/route.ts` yaz**:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { deleteSetting, getSetting, setSetting } from '@/lib/services/settings';
import { getConnection, listConnections } from '@/lib/services/connections';
import { listVoices } from '@/lib/services/voices';
import { quotaLimit } from '@/lib/services/quota';

function maskKey(v: string): string { return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`; }

export async function GET() {
  const db = getDb();
  const connections = listConnections(db).map((c) => ({ id: c.id, label: c.label, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey }));
  const providers = ['gemini', 'piper', ...connections.map((c) => c.id)];
  const dbKey = getSetting(db, 'gemini_api_key');
  return NextResponse.json({
    provider: getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini',
    model: getSetting(db, 'model') ?? '',
    llmProvider: getSetting(db, 'llm_provider') ?? 'gemini',
    llmModel: getSetting(db, 'llm_model') ?? '',
    piperExe: getSetting(db, 'piper_exe') ?? '',
    geminiKey: dbKey ? maskKey(dbKey) : null,
    geminiKeySource: dbKey ? 'db' : process.env.GEMINI_API_KEY ? 'env' : null,
    quotaLimits: Object.fromEntries(providers.map((p) => [p, quotaLimit(db, p)])),
    connections,
    voices: Object.fromEntries(['gemini', 'piper', ...connections.map((c) => c.id)].map((p) => [p, listVoices(db, p)])),
  });
}

const putSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().optional(),
  llmProvider: z.enum(['gemini', 'mock']).optional(),
  llmModel: z.string().optional(),
  piperExe: z.string().optional(),
  // Maskeli değerin geri yazılmasına karşı koruma: • içeren anahtar reddedilir.
  geminiKey: z.string().min(8).refine((v) => !v.includes('•'), 'maskeli değer kaydedilemez').nullable().optional(),
  quotaLimits: z.record(z.number().int().positive().nullable()).optional(),
}).strict();

export async function PUT(req: Request) {
  const db = getDb();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz gövde' }, { status: 400 });
  const b = parsed.data;
  if (b.provider && !['gemini', 'piper', 'mock'].includes(b.provider) && !getConnection(db, b.provider))
    return NextResponse.json({ error: `Bilinmeyen sağlayıcı: "${b.provider}"` }, { status: 400 });
  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    if (value) setSetting(db, key, value); else deleteSetting(db, key);
  };
  if (b.provider !== undefined) setSetting(db, 'provider', b.provider);
  setOrDelete('model', b.model);
  if (b.llmProvider !== undefined) setSetting(db, 'llm_provider', b.llmProvider);
  setOrDelete('llm_model', b.llmModel);
  setOrDelete('piper_exe', b.piperExe);
  if (b.geminiKey === null) deleteSetting(db, 'gemini_api_key');
  else if (typeof b.geminiKey === 'string') setSetting(db, 'gemini_api_key', b.geminiKey);
  for (const [p, lim] of Object.entries(b.quotaLimits ?? {})) {
    if (lim == null) deleteSetting(db, `quota_limit_${p}`);
    else setSetting(db, `quota_limit_${p}`, String(lim));
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: `app/api/connections/route.ts` yaz**:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createConnection, listConnections, type ConnectionRow } from '@/lib/services/connections';

// apiKey asla dışarı sızmaz — hasKey bayrağıyla gösterilir.
const pub = (c: ConnectionRow) => ({ id: c.id, label: c.label, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey });

export async function GET() {
  return NextResponse.json(listConnections(getDb()).map(pub));
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== 'string' || typeof b.baseUrl !== 'string' || typeof b.model !== 'string')
    return NextResponse.json({ error: 'id, baseUrl ve model gerekli' }, { status: 400 });
  try {
    return NextResponse.json(pub(createConnection(getDb(), {
      id: b.id, label: typeof b.label === 'string' ? b.label : undefined,
      baseUrl: b.baseUrl, apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined, model: b.model,
    })), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 5: `app/api/connections/[id]/route.ts` yaz**:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteConnection, getConnection } from '@/lib/services/connections';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getConnection(db, id)) return NextResponse.json({ error: 'Bağlantı bulunamadı' }, { status: 404 });
  deleteConnection(db, id);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 6: `app/api/voices/route.ts` ve `app/api/voices/[id]/route.ts` yaz**:

`app/api/voices/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { addOpenAiDefaults, addPiperModel, addVoice } from '@/lib/services/voices';

// Üç biçim: {provider, defaults:true} | {provider:'piper', path} | {provider, voice, gender?, tone?}
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.provider !== 'string' || !b.provider) return NextResponse.json({ error: 'provider gerekli' }, { status: 400 });
  const db = getDb();
  try {
    if (b.defaults === true) return NextResponse.json({ added: addOpenAiDefaults(db, b.provider) });
    if (typeof b.path === 'string') return NextResponse.json(addPiperModel(db, b.path), { status: 201 });
    if (typeof b.voice === 'string')
      return NextResponse.json(addVoice(db, {
        provider: b.provider, voice: b.voice,
        gender: typeof b.gender === 'string' ? b.gender : undefined,
        tone: typeof b.tone === 'string' ? b.tone : undefined,
      }), { status: 201 });
    return NextResponse.json({ error: 'voice, path veya defaults gerekli' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/voices/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteVoice, updateVoice } from '@/lib/services/voices';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(updateVoice(getDb(), id, {
      gender: typeof b.gender === 'string' ? b.gender : undefined,
      tone: typeof b.tone === 'string' ? b.tone : undefined,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteVoice(getDb(), id);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 7: Testleri çalıştır, PASS doğrula** — `npm test -- tests/panel/api-settings.test.ts` + tam suite.

- [ ] **Step 8: Commit**

```bash
git add app/api/settings app/api/connections app/api/voices tests/panel/api-settings.test.ts
git commit -m "feat(panel): ayar/bağlantı/ses API rotaları — maskeli anahtar, kota limitleri"
```

---

### Task 6: Ses havuzu genellemesi — voices-pool DB'den + annotation entegrasyonu

**Files:**
- Modify: `lib/voices-pool.ts` (yeniden yazılır)
- Modify: `lib/services/annotation.ts` (havuz DB'den; erken doğrulama)
- Test: `tests/panel/voices-pool.test.ts` (yeniden yazılır), `tests/panel/annotation.test.ts` (ekleme)

**Interfaces:**
- Consumes: `voices` tablosu (Task 1), `activeProvider` (quota).
- Produces:
  - `loadPool(db: Db, provider: string): PoolVoice[]` — `PoolVoice { voiceId: string; gender: string; tone: string }`, `voiceId = "<provider>:<voice>"`
  - `pickVoice(pool: PoolVoice[], gender: string, used: Set<string>): string` — İMZA DEĞİŞTİ (havuz parametre); boş havuzda fırlatır
  - `VOICE_POOL` ve `DEFAULT_NARRATOR_VOICE` sabitleri SİLİNİR (tohum artık migration'da)

- [ ] **Step 1: Failing testleri yaz** — `tests/panel/voices-pool.test.ts` dosyasını şununla DEĞİŞTİR:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { addVoice } from '@/lib/services/voices';
import { loadPool, pickVoice } from '@/lib/voices-pool';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('loadPool', () => {
  test('gemini tohumu: 8 ses, ilk Charon, voiceId "provider:voice" biçiminde', () => {
    const pool = loadPool(db, 'gemini');
    expect(pool).toHaveLength(8);
    expect(pool[0].voiceId).toBe('gemini:Charon');
    expect(pool.every((v) => v.voiceId.startsWith('gemini:'))).toBe(true);
  });
  test('başka sağlayıcının havuzu ayrı', () => {
    addVoice(db, { provider: 'sunucum', voice: 'alloy' });
    expect(loadPool(db, 'sunucum').map((v) => v.voiceId)).toEqual(['sunucum:alloy']);
  });
});

describe('pickVoice', () => {
  const pool = (db: Db) => loadPool(db, 'gemini');
  test('cinsiyete uygun + kullanılmamış atar', () => {
    const used = new Set<string>(['gemini:Charon']);
    const v1 = pickVoice(pool(db), 'female', used);
    expect(pool(db).find((v) => v.voiceId === v1)?.gender).toBe('female');
    const v2 = pickVoice(pool(db), 'female', used);
    expect(v2).not.toBe(v1);
  });
  test('unknown cinsiyet ve havuz bitimi fırlatmaz (deterministik döngü)', () => {
    const used = new Set<string>();
    for (let i = 0; i < 12; i++) expect(() => pickVoice(pool(db), 'unknown', used)).not.toThrow();
  });
  test('cinsiyeti tutan ses yoksa tüm havuza düşer (öksüz kalmaz)', () => {
    addVoice(db, { provider: 'notr', voice: 'tek' }); // gender ''
    expect(pickVoice(loadPool(db, 'notr'), 'female', new Set())).toBe('notr:tek');
  });
  test('boş havuz Türkçe hatayla fırlatır', () => {
    expect(() => pickVoice([], 'male', new Set())).toThrow(/havuz boş/);
  });
});
```

`tests/panel/annotation.test.ts`'e ekle (dosyanın mevcut kurulum yardımcılarını kullan; MockLlmAdapter + multi mod kurulumunu mevcut testlerden kopyala):

```ts
test('havuz aktif sağlayıcıdan gelir: sağlayıcı bağlantıysa voice_id o slug ile başlar', async () => {
  // kurulum: bölüm (voiceMode multi) + createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'm' })
  // + addVoice(db, { provider: 'sunucum', voice: 'alloy', gender: 'male' }) + setSetting(db, 'provider', 'sunucum')
  const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
  const script = JSON.parse(latestScript(db, chapterId)!.json);
  expect(script.cast.every((c: { voice_id: string }) => c.voice_id.startsWith('sunucum:'))).toBe(true);
});

test('aktif sağlayıcının havuzu boşsa LLM çağrısı YAPILMADAN Türkçe hata', async () => {
  // kurulum: createConnection(db, { id: 'bos', baseUrl: 'http://x/v1', model: 'm' }) + setSetting(db, 'provider', 'bos')
  await expect(annotateChapter(db, chapterId, new MockLlmAdapter())).rejects.toThrow(/havuz boş/);
});

test('mock TTS sağlayıcısı gemini havuzunu kullanır (test altyapısı istisnası)', async () => {
  // kurulum: setSetting(db, 'provider', 'mock')
  const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
  const script = JSON.parse(latestScript(db, chapterId)!.json);
  expect(script.cast[0].voice_id).toBe('gemini:Charon');
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula.**

- [ ] **Step 3: `lib/voices-pool.ts`'i şu hale getir** (dosyanın tamamı):

```ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { voices } from './db/schema';

export interface PoolVoice { voiceId: string; gender: string; tone: string }

// Sağlayıcının ses havuzu: voices tablosundan, ekleniş sırasıyla (tohum: Charon ilk).
export function loadPool(db: Db, provider: string): PoolVoice[] {
  return db.select().from(voices).where(eq(voices.provider, provider))
    .orderBy(asc(voices.createdAt), asc(voices.id)).all()
    .map((v) => ({ voiceId: `${v.provider}:${v.voice}`, gender: v.gender, tone: v.tone }));
}

// Cinsiyete uygun, kullanılmamış ilk ses; cinsiyet tutmuyorsa tüm havuz; havuz biterse deterministik döngü.
export function pickVoice(pool: PoolVoice[], gender: string, used: Set<string>): string {
  if (pool.length === 0) throw new Error('Aktif sağlayıcının ses havuzu boş — Ayarlar’dan ses ekleyin');
  const candidates = gender === 'male' || gender === 'female' ? pool.filter((v) => v.gender === gender) : pool;
  const base = candidates.length ? candidates : pool;
  const free = base.filter((v) => !used.has(v.voiceId));
  const pick = (free[0] ?? base[used.size % base.length]).voiceId;
  used.add(pick);
  return pick;
}
```

(`’` = gerçek U+2019 karakteri olarak yaz.)

- [ ] **Step 4: `lib/services/annotation.ts`'i güncelle**:

Import değişikliği: `import { loadPool, pickVoice } from '../voices-pool';` (DEFAULT_NARRATOR_VOICE kalktı) + `import { activeProvider } from './quota';`

`annotateChapter` içinde, `const chunks = chunkText(chapter.rawText);` satırından HEMEN SONRA (LLM çağrılarından ÖNCE — token harcamadan erken doğrulama):

```ts
  // Havuz aktif TTS sağlayıcısından; mock test altyapısıdır, gemini havuzunu kullanır.
  const providerName = activeProvider(db).name;
  const pool = loadPool(db, providerName === 'mock' ? 'gemini' : providerName);
  const narratorVoice = getSetting(db, 'default_voice') ?? pool[0]?.voiceId;
  if (!narratorVoice) throw new Error('Aktif sağlayıcının ses havuzu boş — Ayarlar’dan ses ekleyin');
```

Ses atama bloğunda ESKİ iki satırı değiştir:

```ts
// ESKİ:
  const narratorVoice = getSetting(db, 'default_voice') ?? DEFAULT_NARRATOR_VOICE;
  const used = new Set<string>([narratorVoice]);
// YENİ (narratorVoice yukarıda hesaplandı):
  const used = new Set<string>([narratorVoice]);
```

ve `pickVoice(c.gender, used)` çağrısını `pickVoice(pool, c.gender, used)` yap.

- [ ] **Step 5: Testleri çalıştır, PASS doğrula** — `npm test` tam suite. Mevcut annotation testleri anlatıcıda `gemini:Charon` bekliyorsa geçmeye devam eder (tohum ilk ses Charon).

- [ ] **Step 6: Commit**

```bash
git add lib/voices-pool.ts lib/services/annotation.ts tests/panel/voices-pool.test.ts tests/panel/annotation.test.ts
git commit -m "feat(panel): ses havuzu DB'den — sağlayıcı-bazlı loadPool + boş havuzda erken hata"
```

---

### Task 7: UI — /settings sayfası, sidebar bağlantısı, gear ikonu, preflight stil notu

**Files:**
- Modify: `lib/ui/Icon.tsx` (`gear` ikonu)
- Create: `app/settings/page.tsx`
- Modify: `lib/ui/Sidebar.tsx` (alta "Ayarlar" bağlantısı)
- Modify: `app/chapters/[id]/page.tsx` (Preflight tipi + stil notu)
- Modify: `app/globals.css` (yalnız gerekiyorsa küçük ekleme — önce mevcut sınıflarla dene)

**Interfaces:**
- Consumes: Task 5 API'leri; mevcut `Icon`, `ConfirmButton`, `EmptyState`, `.card/.rows/.row/.btn/.muted/.badge` sınıfları; `refreshTree` GEREKMEZ (ayarlar ağacı etkilemez).
- Produces: `/settings` sayfası; `IconName`'e `gear` eklenir.

**Görsel dil:** mevcut koyu stüdyo token sistemi — yeni renk/typeface YOK; kartlar bölüm çalışma alanındaki `.card` düzeninde, ancak sahne numarası (01/02/03) KULLANILMAZ (ayarlar bir sıra değildir). Formlar mevcut input/button stilleriyle.

- [ ] **Step 1: Icon'a gear ekle** — `IconName` union'ına `| 'gear'`; `paths`'e:

```tsx
  gear: <><circle cx="8" cy="8" r="2.4" /><path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5" /></>,
```

- [ ] **Step 2: Sidebar'a bağlantı ekle** — `lib/ui/Sidebar.tsx` içinde "Yeni proje" satırını şununla değiştir:

```tsx
          {tree !== null && (
            <>
              <Link href="/" className="side-item manage"><Icon name="plus" size={12} /> Yeni proje</Link>
              <Link href="/settings" className={pathname === '/settings' ? 'side-item manage on' : 'side-item manage'}>
                <Icon name="gear" size={12} /> Ayarlar
              </Link>
            </>
          )}
```

- [ ] **Step 3: `app/settings/page.tsx` yaz** (tamamı):

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';

type VoiceRow = { id: string; provider: string; voice: string; gender: string; tone: string; path: string | null };
type Conn = { id: string; label: string; baseUrl: string; model: string; hasKey: boolean };
type SettingsData = {
  provider: string; model: string; llmProvider: string; llmModel: string; piperExe: string;
  geminiKey: string | null; geminiKeySource: 'db' | 'env' | null;
  quotaLimits: Record<string, number | null>;
  connections: Conn[]; voices: Record<string, VoiceRow[]>;
};

const GENDER_LABEL: Record<string, string> = { male: 'Erkek', female: 'Kadın', '': '—' };

async function patchVoice(id: string, patch: { gender?: string; tone?: string }) {
  await fetch(`/api/voices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}

// Üst seviye bileşen (SettingsPage İÇİNDE TANIMLAMA — iç içe bileşen her render'da remount olur, state kaybedilir).
function VoicePool({ provider, rows, withPath, reload, onError }: {
  provider: string; rows: VoiceRow[]; withPath?: boolean;
  reload: () => Promise<void>; onError: (msg: string) => void;
}) {
  const [nv, setNv] = useState({ voice: '', gender: '', tone: '', path: '' });

  async function add(body: unknown) {
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) onError((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Ses eklenemedi');
    else setNv({ voice: '', gender: '', tone: '', path: '' });
    await reload();
  }

  return (
    <div className="rows">
      {rows.length === 0 && <p className="muted">Havuz boş.</p>}
      {rows.map((v) => (
        <div key={v.id} className="rowitem">
          <span className="mono">{v.voice}</span>
          <select
            value={v.gender} aria-label="Cinsiyet"
            onChange={async (e) => { await patchVoice(v.id, { gender: e.target.value }); reload(); }}
          >
            {Object.entries(GENDER_LABEL).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input
            defaultValue={v.tone} placeholder="ton (ör. olgun, anlatıcı)" aria-label="Ton"
            onBlur={async (e) => { if (e.target.value !== v.tone) { await patchVoice(v.id, { tone: e.target.value }); reload(); } }}
          />
          <ConfirmButton onConfirm={async () => { await fetch(`/api/voices/${v.id}`, { method: 'DELETE' }); reload(); }} ariaLabel="Sesi sil" />
        </div>
      ))}
      {withPath ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.path.trim()) add({ provider: 'piper', path: nv.path.trim() }); }}>
          <input value={nv.path} onChange={(e) => setNv({ ...nv, path: e.target.value })} placeholder="C:\piper\sesler\tr_TR-fahrettin-medium.onnx" />
          <button type="submit"><Icon name="plus" /> Model ekle</button>
        </form>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.voice.trim()) add({ provider, voice: nv.voice.trim(), gender: nv.gender, tone: nv.tone }); }}>
          <input value={nv.voice} onChange={(e) => setNv({ ...nv, voice: e.target.value })} placeholder="ses adı" style={{ maxWidth: '10rem' }} />
          <select value={nv.gender} onChange={(e) => setNv({ ...nv, gender: e.target.value })} aria-label="Cinsiyet">
            {Object.entries(GENDER_LABEL).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input value={nv.tone} onChange={(e) => setNv({ ...nv, tone: e.target.value })} placeholder="ton" style={{ maxWidth: '10rem' }} />
          <button type="submit"><Icon name="plus" /> Ekle</button>
        </form>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [err, setErr] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [piperInput, setPiperInput] = useState('');
  const [llmModelInput, setLlmModelInput] = useState('');
  const [conn, setConn] = useState({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) { setErr('Ayarlar yüklenemedi'); return; }
    const d: SettingsData = await res.json();
    setData(d); setModelInput(d.model); setPiperInput(d.piperExe); setLlmModelInput(d.llmModel);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function put(patch: Record<string, unknown>) {
    setErr('');
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Kaydedilemedi');
    await load();
  }

  async function addConnection() {
    setErr('');
    const res = await fetch('/api/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: conn.id, label: conn.label || undefined, baseUrl: conn.baseUrl, apiKey: conn.apiKey || undefined, model: conn.model }),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Bağlantı eklenemedi');
    else setConn({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });
    await load();
  }

  async function addDefaults(provider: string) {
    setErr('');
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, defaults: true }) });
    if (!res.ok) setErr('Sesler eklenemedi');
    await load();
  }

  async function delConnection(id: string) { setErr(''); await fetch(`/api/connections/${id}`, { method: 'DELETE' }); await load(); }

  if (data === null) return <p className="muted">Yükleniyor…</p>;

  const providerOptions = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'piper', label: 'Piper (lokal)' },
    ...data.connections.map((c) => ({ value: c.id, label: `${c.label} (OpenAI-uyumlu)` })),
    { value: 'mock', label: 'Mock (test)' },
  ];

  return (
    <>
      <div className="crumbs"><span className="here">Ayarlar</span></div>
      <h1>Ayarlar</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      <div className="card">
        <h2><Icon name="speaker" /> Aktif TTS sağlayıcısı</h2>
        <p className="row">
          <select value={data.provider} onChange={(e) => put({ provider: e.target.value })} aria-label="Aktif sağlayıcı">
            {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </p>
      </div>

      <div className="card">
        <h2><Icon name="wave" /> Gemini</h2>
        <div className="rows">
          <div className="rowitem">
            <span>API anahtarı</span>
            <span className="mono muted">
              {data.geminiKeySource === 'db' && data.geminiKey}
              {data.geminiKeySource === 'env' && <span className="badge">env&#39;den</span>}
              {data.geminiKeySource === null && '—'}
            </span>
          </div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (keyInput.trim()) { await put({ geminiKey: keyInput.trim() }); setKeyInput(''); } }}>
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Yeni anahtar (DB&#39;ye kaydedilir)" autoComplete="off" />
            <button type="submit">Kaydet</button>
            {data.geminiKeySource === 'db' && <button type="button" className="ghost" onClick={() => put({ geminiKey: null })}>DB&#39;den sil</button>}
          </form>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ model: modelInput.trim() }); }}>
            <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} placeholder="model (boş = varsayılan)" />
            <button type="submit">Kaydet</button>
          </form>
        </div>
        <h2 style={{ marginTop: '1rem' }}><Icon name="person" /> Gemini ses havuzu</h2>
        <VoicePool provider="gemini" rows={data.voices.gemini ?? []} reload={load} onError={setErr} />
      </div>

      <div className="card">
        <h2><Icon name="doc" /> OpenAI-uyumlu bağlantılar</h2>
        {data.connections.length === 0 && <p className="muted">Henüz bağlantı yok. Lokal bir sunucu (AllTalk, openedai-speech…) veya OpenAI için ekle.</p>}
        {data.connections.map((c) => (
          <details key={c.id} className="conn">
            <summary className="rowitem">
              <span className="mono">{c.id}</span>
              <span className="muted">{c.baseUrl} · {c.model}</span>
              {c.hasKey && <span className="badge">anahtarlı</span>}
              {/* summary içindeki tıklamalar details'i açıp kapatmasın */}
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <ConfirmButton onConfirm={() => delConnection(c.id)} ariaLabel="Bağlantıyı sil" />
              </span>
            </summary>
            <button className="ghost" onClick={() => addDefaults(c.id)}>Resmî OpenAI seslerini ekle</button>
            <VoicePool provider={c.id} rows={data.voices[c.id] ?? []} reload={load} onError={setErr} />
          </details>
        ))}
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); addConnection(); }}>
          <input value={conn.id} onChange={(e) => setConn({ ...conn, id: e.target.value })} placeholder="ad (ör. alltalk-lokal)" style={{ maxWidth: '10rem' }} />
          <input value={conn.baseUrl} onChange={(e) => setConn({ ...conn, baseUrl: e.target.value })} placeholder="http://localhost:8000/v1" />
          <input value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} placeholder="model (ör. tts-1)" style={{ maxWidth: '9rem' }} />
          <input type="password" value={conn.apiKey} onChange={(e) => setConn({ ...conn, apiKey: e.target.value })} placeholder="anahtar (opsiyonel)" style={{ maxWidth: '10rem' }} autoComplete="off" />
          <button type="submit"><Icon name="plus" /> Bağlantı ekle</button>
        </form>
      </div>

      <div className="card">
        <h2><Icon name="speaker" /> Piper (lokal)</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ piperExe: piperInput.trim() }); }}>
          <input value={piperInput} onChange={(e) => setPiperInput(e.target.value)} placeholder="C:\piper\piper.exe" />
          <button type="submit">Kaydet</button>
        </form>
        <p className="muted">Kurulum ve Türkçe ses modelleri için README&#39;deki Piper bölümüne bak.</p>
        <VoicePool provider="piper" rows={data.voices.piper ?? []} withPath reload={load} onError={setErr} />
      </div>

      <div className="card">
        <h2><Icon name="warn" /> Günlük kota limitleri</h2>
        <div className="rows">
          {Object.entries(data.quotaLimits).map(([p, lim]) => (
            <div key={p} className="rowitem">
              <span className="mono">{p}</span>
              <input
                type="number" min={1} defaultValue={lim ?? ''} placeholder="limitsiz" aria-label={`${p} günlük limit`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const n = v === '' ? null : Number(v);
                  if (n !== lim && (n === null || (Number.isInteger(n) && n > 0))) put({ quotaLimits: { [p]: n } });
                }}
                style={{ maxWidth: '8rem' }}
              />
              <span className="muted">{lim == null ? 'limitsiz' : `${lim}/gün`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2><Icon name="doc" /> LLM (annotation)</h2>
        <div className="row">
          <select value={data.llmProvider} onChange={(e) => put({ llmProvider: e.target.value })} aria-label="LLM sağlayıcısı">
            <option value="gemini">Gemini</option>
            <option value="mock">Mock (test)</option>
          </select>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ llmModel: llmModelInput.trim() }); }}>
            <input value={llmModelInput} onChange={(e) => setLlmModelInput(e.target.value)} placeholder="model (boş = varsayılan)" />
            <button type="submit">Kaydet</button>
          </form>
        </div>
        <p className="muted">Gemini LLM, yukarıdaki Gemini API anahtarını kullanır.</p>
      </div>
    </>
  );
}
```

Not: `VoicePool` bilinçli olarak modül üst seviyesinde tanımlıdır (iç içe bileşen tanımı her üst render'da remount + state kaybı yaratır — yapma).

- [ ] **Step 4: Preflight stil notu** — `app/chapters/[id]/page.tsx`:

Tip satırını güncelle:

```ts
  type Preflight = { total: number; cached: number; newCalls: number; supportsStyle: boolean; styledSegments: number; quota: { provider: string; used: number; limit: number; remaining: number } | null; fits: boolean };
```

Preflight satırının (`{pf.quota && …}` kapanışından sonra, aynı `<p className="muted">` bloğunun ALTINA yeni satır olarak) ekle:

```tsx
        {pf && !pf.supportsStyle && pf.styledSegments > 0 && (
          <p className="muted"><Icon name="warn" size={12} /> Bu sağlayıcı stil desteklemiyor — segmentler düz okunur.</p>
        )}
```

- [ ] **Step 5: CSS kontrolü** — sayfayı mevcut sınıflarla kur; yalnız `details.conn` için gerekiyorsa `app/globals.css`'e küçük blok ekle:

```css
/* Ayarlar: bağlantı katlanır kartı */
details.conn { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .5rem .75rem; margin: .5rem 0; }
details.conn > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: .6rem; }
details.conn > summary::-webkit-details-marker { display: none; }
.row.wrap { flex-wrap: wrap; }
```

(`.row.wrap` zaten varsa ekleme.)

- [ ] **Step 6: Doğrula** — `npm run build` temiz; `npm test` tam suite yeşil. (Dev server ile görsel kontrol final aşamada kullanıcıyla yapılır — build'i dev server açıkken ÇALIŞTIRMA.)

- [ ] **Step 7: Commit**

```bash
git add lib/ui/Icon.tsx lib/ui/Sidebar.tsx app/settings/page.tsx app/chapters/[id]/page.tsx app/globals.css
git commit -m "feat(panel): ayarlar ekranı — sağlayıcılar, bağlantılar, ses havuzları, kota, LLM + stil notu"
```

---

### Task 8: Dokümantasyon + smoke

**Files:**
- Modify: `README.md` (Sağlayıcılar bölümü)
- Modify: `CLAUDE.md` (C2 ✅, sıradaki Dilim D, kısıt güncellemesi)
- Modify: `.env.example` (yorum satırı: anahtar artık panelden de girilebilir)

**Interfaces:** —

- [ ] **Step 1: README'ye "TTS Sağlayıcıları" bölümü ekle** (mevcut kurulum bölümünün altına):

```markdown
## TTS Sağlayıcıları

Aktif sağlayıcı ve tüm yapılandırma panel içinden yönetilir: **Ayarlar** (sol panelin altı).

### Gemini (varsayılan)
API anahtarını `.env` (`GEMINI_API_KEY`) veya Ayarlar ekranından gir. Ücretsiz katmanda
günde ~100 istek sınırı vardır; panel preflight + kota defteriyle bunu yönetir.

### OpenAI-uyumlu sunucular (lokal veya bulut)
`/v1/audio/speech` uygulayan her sunucu: OpenAI TTS, [AllTalk](https://github.com/erew123/alltalk_tts),
[openedai-speech](https://github.com/matatonic/openedai-speech), LocalAI…
Ayarlar → "OpenAI-uyumlu bağlantılar" → ad + URL (`/v1` dahil, ör. `http://localhost:8000/v1`) +
model + (gerekiyorsa) anahtar. Bağlantının ses havuzunu elle doldur veya "Resmî OpenAI seslerini ekle".
Not: sunucu `response_format: "wav"` desteklemeli (yaygın durum).

### Piper (ücretsiz, lokal, CPU)
1. [Piper sürümünü](https://github.com/OHF-Voice/piper1-gpl/releases) indir, bir klasöre aç (`piper.exe`).
2. Türkçe ses modeli indir (`.onnx` + `.onnx.json` YAN YANA aynı klasörde):
   [tr_TR-fahrettin-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/fahrettin/medium),
   [tr_TR-dfki-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium),
   [tr_TR-fettah-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/fettah/medium).
3. Ayarlar → Piper: exe yolunu gir, model dosyalarını ekle (ses adı dosya adından türer).

Stil/duygu yönergelerini yalnız Gemini uygular; diğer sağlayıcılarda segmentler düz okunur
(panel preflight satırında not gösterir).
```

- [ ] **Step 2: CLAUDE.md'yi güncelle**:
  - "Ne yapıldı / ne kaldı": `⬜ Dilim C2` satırını `✅ **Dilim C2 — Sağlayıcı ekosistemi** (spec: docs/superpowers/specs/2026-07-17-panel-slice-c2-provider-ecosystem-design.md, plan: docs/superpowers/plans/2026-07-18-panel-slice-c2-provider-ecosystem.md): OpenAI-uyumlu adlandırılmış bağlantılar + Piper lokal adapter (kullanıcı kurulumlu), /settings ekranı (anahtarlar DB+env, maskeli), DB-tabanlı sağlayıcı-bazlı ses havuzu, yetenek bildirimi (stilsiz sağlayıcıda stil düşürme + not).` yap; Dilim D satırına `SONRAKİ.` ekle.
  - "Temel kararlar" tablosuna satır: `| TTS sağlayıcıları | Gemini + OpenAI-uyumlu bağlantılar + Piper lokal + Mock; global tek aktif sağlayıcı; ayarlar panel içinden |`
  - Bilinen kısıt #1'e ekle: `GÜNCELLEME (C2): hacim için artık faturasız alternatifler panelde: Piper (lokal, bedava) veya OpenAI-uyumlu lokal sunucular; Chirp adapter'ı istenirse ileride ayrı iş.`
  - "Sonraki oturum için öneri"yi Dilim D (kütüphane + PWA oynatıcı) brainstorming'i olarak yeniden yaz; ertelenmişlere şunları ekle: ses önizleme düğmesi, varsayılan anlatıcı sesi UI'sı, yalnız-mp3 OpenAI-uyumlu sunucular, cache GC.

- [ ] **Step 3: `.env.example`'a yorum ekle** — `GEMINI_API_KEY` satırının üstüne: `# İsteğe bağlı: anahtarı panelden de girebilirsin (Ayarlar ekranı, DB'de saklanır; DB > env önceliklidir)`

- [ ] **Step 4: Tam doğrulama** — `npm run build` + `npm test` (tam suite yeşil; beklenen: 123 + ~25 yeni test).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md .env.example
git commit -m "docs: C2 sağlayıcı ekosistemi — README kurulumları, CLAUDE.md durum güncellemesi"
```

---

## Doğrulama (dilim sonu)

1. `npm test` — tam suite yeşil (çekirdek + panel + yeni C2 testleri).
2. `npm run build` — temiz.
3. Kullanıcı görsel onayı (dev server): `/settings` — sağlayıcı seçimi, bağlantı ekleme, ses havuzları, kota limitleri; bölüm sayfasında piper/bağlantı seçiliyken stil notu.
4. Manuel duman (mock): Ayarlar'da provider=mock → bir bölümde annotate + üret → preflight'ta stil desteği notunun mock'ta GÖRÜNMEDİĞİNİ doğrula (mock stilli).
