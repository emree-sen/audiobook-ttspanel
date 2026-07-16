# Panel Dilim B (LLM Annotation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ham bölüm metni + anlatım tarzı + ses modu → Gemini LLM ile doğrulanmış seslendirme script'i; chunk ilerlemesi SSE ile; ek talimatla yeniden üretme; cast ses düzeltme.

**Architecture:** Provider-agnostic `LlmAdapter` (Gemini + Mock); `lib/services/annotation.ts` chunk'lar → LLM → zod doğrulama (1 retry) → cast birleştirme + havuzdan ses atama → mevcut `saveScript` altyapısıyla `scripts(source='llm')`. UI çalışma alanına ses modu + "Script üret (LLM)" + cast düzeltme + yeniden üret eklenir.

**Tech Stack:** Mevcut yığın (Next 15, Drizzle/SQLite, zod, vitest, `@google/genai`). Yeni bağımlılık YOK.

**Spec:** `docs/superpowers/specs/2026-07-16-panel-slice-b-llm-annotation-design.md`

## Global Constraints

- Kullanıcıya görünen tüm metinler **Türkçe**; kod stili mevcut `lib/` gibi **kompakt**, Türkçe yorumlar.
- **`src/core/**` değiştirilmez** (yalnızca import edilir).
- Hiçbir sır commit edilmez; testler **ağa çıkmaz** (LLM için `MockLlmAdapter`, TTS için `MockAdapter`).
- Mevcut **62 test her task sonunda yeşil** (`npm test`); her task sonunda `npm run build` da geçmeli (rota/UI task'larında zorunlu).
- Varsayılan LLM modeli **`gemini-2.5-flash`** (GA, ücretsiz kota); settings `llm_model` → env `LLM_MODEL` ile değişir. Provider: settings `llm_provider` → env `LLM_PROVIDER` → `'gemini'`.
- **Not (spec §3 somutlaması):** Gemini structured output `responseMimeType: 'application/json'` + prompt-içi şema + zod-doğrulama/retry ile sağlanır; `jsonSchema`/`responseSchema` alanı arayüzde hazırdır ama Dilim B'de devrede değildir (preview şema desteği kırılganlığına karşı sağlamlık tercihi).
- Chunk hedefi **12.000 karakter**, paragraf sınırından (`CHUNK_TARGET` sabiti `lib/services/annotation.ts`).

---

### Task 1: Veri katmanı — yeni kolonlar + saveScript/changeCastVoice

**Files:**
- Modify: `lib/db/schema.ts` (chapters + scripts kolonları)
- Create: `drizzle/0001_*.sql` (drizzle-kit generate çıktısı — commit edilir)
- Modify: `lib/services/chapters.ts` (ChapterPatch)
- Modify: `lib/services/scripts.ts` (saveScript refactor + changeCastVoice)
- Test: `tests/panel/scripts-b.test.ts`

**Interfaces:**
- Consumes: mevcut `scripts.ts` (importScript/latestScript/listSegments), `parseVoiceId` (`@/src/core/voices`).
- Produces:
  - `chapters.voiceMode` (`voice_mode TEXT NOT NULL DEFAULT 'narrator'`), `chapters.maxCharacters` (`max_characters INTEGER NOT NULL DEFAULT 6`), `scripts.usageJson` (`usage_json TEXT NULL`).
  - `ChapterPatch` + `voiceMode?: string; maxCharacters?: number`.
  - `saveScript(db, chapterId, jsonText, source: 'manual'|'llm', usageJson?: string): { scriptId; version; segmentCount }` — importScript'in genelleştirilmişi; `importScript` artık `saveScript(..., 'manual')` sarmalayıcısı.
  - `changeCastVoice(db, chapterId, characterId, voiceId): { scriptId; version }` — en güncel script'in cast'inde sesi değiştirip YENİ versiyon yazar (LLM yok); bilinmeyen karakter/bozuk voiceId'de Türkçe `Error`.

- [ ] **Step 1: Şema kolonlarını ekle**

`lib/db/schema.ts` — `chapters` tablosunda `status` satırından ÖNCE ekle:

```ts
  voiceMode: text('voice_mode').notNull().default('narrator'), // narrator|multi
  maxCharacters: integer('max_characters').notNull().default(6),
```

`scripts` tablosunda `json` satırından SONRA ekle:

```ts
  usageJson: text('usage_json'), // LLM üretiminde {"inputTokens":..,"outputTokens":..,"chunks":..}
```

- [ ] **Step 2: Migrasyon üret**

Çalıştır: `npm run db:generate`
Beklenen: `drizzle/0001_*.sql` oluşur (3 `ALTER TABLE ... ADD COLUMN`). Commit edilecek.

- [ ] **Step 3: Failing test yaz**

`tests/panel/scripts-b.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { changeCastVoice, importScript, latestScript, saveScript } from '@/lib/services/scripts';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  return { db, chapterId: c.id };
}

describe('şema genişletmesi', () => {
  test('yeni bölüm varsayılanları: voiceMode narrator, maxCharacters 6', () => {
    const { db, chapterId } = setup();
    const c = getChapter(db, chapterId)!;
    expect(c.voiceMode).toBe('narrator');
    expect(c.maxCharacters).toBe(6);
  });
});

describe('saveScript', () => {
  test('source=llm + usageJson kaydedilir; importScript manual kalır', () => {
    const { db, chapterId } = setup();
    const usage = JSON.stringify({ inputTokens: 10, outputTokens: 20, chunks: 1 });
    const r = saveScript(db, chapterId, FIXTURE, 'llm', usage);
    expect(r.version).toBe(1);
    expect(latestScript(db, chapterId)).toMatchObject({ source: 'llm', usageJson: usage });

    const r2 = importScript(db, chapterId, FIXTURE);
    expect(r2.version).toBe(2);
    expect(latestScript(db, chapterId)).toMatchObject({ source: 'manual', usageJson: null });
  });
});

describe('changeCastVoice', () => {
  test('sesi değiştirir, yeni versiyon yazar, source/usage korunur', () => {
    const { db, chapterId } = setup();
    saveScript(db, chapterId, FIXTURE, 'llm', '{"inputTokens":1,"outputTokens":2,"chunks":1}');
    const r = changeCastVoice(db, chapterId, 'kaan', 'gemini:Iapetus');
    expect(r.version).toBe(2);
    const scr = latestScript(db, chapterId)!;
    expect(scr.source).toBe('llm');
    expect(scr.usageJson).toContain('inputTokens');
    const cast = JSON.parse(scr.json).cast as { character_id: string; voice_id: string }[];
    expect(cast.find((c) => c.character_id === 'kaan')?.voice_id).toBe('gemini:Iapetus');
    expect(cast.find((c) => c.character_id === 'narrator')?.voice_id).toBe('gemini:Charon'); // dokunulmadı
  });

  test('bilinmeyen karakter / bozuk voiceId / script yok → Türkçe hata', () => {
    const { db, chapterId } = setup();
    expect(() => changeCastVoice(db, chapterId, 'kaan', 'gemini:X')).toThrow(/script/i);
    importScript(db, chapterId, FIXTURE);
    expect(() => changeCastVoice(db, chapterId, 'hayalet', 'gemini:Puck')).toThrow(/Karakter bulunamadı/);
    expect(() => changeCastVoice(db, chapterId, 'kaan', 'bozukses')).toThrow(/voice_id/);
  });
});
```

- [ ] **Step 4: Testin fail ettiğini doğrula**

Çalıştır: `npx vitest run tests/panel/scripts-b.test.ts`
Beklenen: FAIL (`saveScript`/`changeCastVoice` export yok; voiceMode kolonu migration'sız da fail eder).

- [ ] **Step 5: chapters.ts + scripts.ts güncelle**

`lib/services/chapters.ts` — `ChapterPatch` tipini şu hale getir:

```ts
export type ChapterPatch = { title?: string; rawText?: string; narrationStyle?: string | null; position?: number; status?: string; voiceMode?: string; maxCharacters?: number };
```

`lib/services/scripts.ts` — dosyanın tamamını şununla değiştir:

```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { scripts, segments } from '../db/schema';
import { newId } from '../id';
import { updateChapter } from './chapters';
import { parseScript } from '@/src/core/schema';
import { parseVoiceId, resolveVoiceForSpeaker, validateSpeakers } from '@/src/core/voices';

export type ScriptRow = typeof scripts.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;

// Script JSON'unu doğrular ve versiyonlu kaydeder (manual: elle yapıştırma, llm: annotation).
// Geçersiz girişte fırlatır (SyntaxError | ZodError | Error) — hiçbir satır yazılmaz.
export function saveScript(db: Db, chapterId: string, jsonText: string, source: 'manual' | 'llm', usageJson?: string): { scriptId: string; version: number; segmentCount: number } {
  const parsed = parseScript(JSON.parse(jsonText));
  validateSpeakers(parsed); // bilinmeyen konuşmacı varsa erken ve anlaşılır hata

  const last = db.select({ v: scripts.version }).from(scripts)
    .where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
  const version = (last?.v ?? 0) + 1;
  const scriptId = newId('scr');
  const now = Date.now();

  db.insert(scripts).values({ id: scriptId, chapterId, version, source, json: jsonText, usageJson: usageJson ?? null, createdAt: now }).run();
  db.insert(segments).values(parsed.segments.map((s, i) => ({
    id: newId('seg'), chapterId, scriptId, idx: i,
    speaker: s.speaker, style: s.style ?? null, text: s.text,
    voice: resolveVoiceForSpeaker(parsed, s.speaker).cast.voiceId,
    status: 'pending', createdAt: now, updatedAt: now,
  }))).run();
  updateChapter(db, chapterId, { status: 'scripted' });

  return { scriptId, version, segmentCount: parsed.segments.length };
}

export function importScript(db: Db, chapterId: string, jsonText: string): { scriptId: string; version: number; segmentCount: number } {
  return saveScript(db, chapterId, jsonText, 'manual');
}

// En güncel script'in cast'inde bir karakterin sesini değiştirip yeni versiyon yazar (LLM çağrısı yok).
export function changeCastVoice(db: Db, chapterId: string, characterId: string, voiceId: string): { scriptId: string; version: number } {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok');
  parseVoiceId(voiceId); // format doğrulaması (geçersizse fırlatır)
  const json = JSON.parse(scr.json) as { cast?: { character_id: string; voice_id: string }[] };
  const member = json.cast?.find((c) => c.character_id === characterId);
  if (!member) throw new Error(`Karakter bulunamadı: "${characterId}"`);
  member.voice_id = voiceId;
  const saved = saveScript(db, chapterId, JSON.stringify(json), scr.source as 'manual' | 'llm', scr.usageJson ?? undefined);
  return { scriptId: saved.scriptId, version: saved.version };
}

export function latestScript(db: Db, chapterId: string): ScriptRow | undefined {
  return db.select().from(scripts).where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
}

export function listSegments(db: Db, scriptId: string): SegmentRow[] {
  return db.select().from(segments).where(eq(segments.scriptId, scriptId)).orderBy(segments.idx).all();
}
```

Not: `parseVoiceId` `src/core/voices.ts`'te var ve mesajı `Geçersiz voice_id: ...` — testteki `/voice_id/` beklentisi bununla eşleşir.

- [ ] **Step 6: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run tests/panel/scripts-b.test.ts` → PASS (5 test).
Çalıştır: `npm test` → tümü yeşil (eski 62 + 5).

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/ lib/services/chapters.ts lib/services/scripts.ts tests/panel/scripts-b.test.ts
git commit -m "feat(panel): şema genişletme (voice_mode, max_characters, usage_json) + saveScript/changeCastVoice"
```

---

### Task 2: Ses havuzu

**Files:**
- Create: `lib/voices-pool.ts`
- Test: `tests/panel/voices-pool.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `VOICE_POOL: PoolVoice[]` (`{ voiceId, gender: 'male'|'female', tone }`), `DEFAULT_NARRATOR_VOICE = 'gemini:Charon'`
  - `pickVoice(gender: string, used: Set<string>): string` — cinsiyete uygun kullanılmamış ilk ses; havuz biterse deterministik döngü; `used`'a ekler.

- [ ] **Step 1: Failing test yaz**

`tests/panel/voices-pool.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { DEFAULT_NARRATOR_VOICE, VOICE_POOL, pickVoice } from '@/lib/voices-pool';

describe('voice pool', () => {
  test('havuz dolu ve varsayılan anlatıcı havuzda', () => {
    expect(VOICE_POOL.length).toBeGreaterThanOrEqual(6);
    expect(VOICE_POOL.some((v) => v.voiceId === DEFAULT_NARRATOR_VOICE)).toBe(true);
  });

  test('cinsiyete uygun + kullanılmamış atar', () => {
    const used = new Set<string>([DEFAULT_NARRATOR_VOICE]);
    const v1 = pickVoice('female', used);
    expect(VOICE_POOL.find((v) => v.voiceId === v1)?.gender).toBe('female');
    const v2 = pickVoice('female', used);
    expect(v2).not.toBe(v1);
    expect(used.has(v1)).toBe(true);
  });

  test('unknown cinsiyet herhangi bir sesten alır; havuz bitince döngü (fırlatmaz)', () => {
    const used = new Set<string>();
    for (let i = 0; i < VOICE_POOL.length + 3; i++) expect(() => pickVoice('unknown', used)).not.toThrow();
  });

  test('deterministik: aynı sırayla aynı sonuç', () => {
    const a = new Set<string>(), b = new Set<string>();
    expect([pickVoice('male', a), pickVoice('female', a)]).toEqual([pickVoice('male', b), pickVoice('female', b)]);
  });
});
```

- [ ] **Step 2: Fail doğrula**

Çalıştır: `npx vitest run tests/panel/voices-pool.test.ts` → FAIL (modül yok).

- [ ] **Step 3: Implementasyon**

`lib/voices-pool.ts`:

```ts
export interface PoolVoice { voiceId: string; gender: 'male' | 'female'; tone: string }

// Bake-off'ta doğrulanmış Gemini prebuilt sesleri (etiketler UI/atama için; genişletilebilir).
export const VOICE_POOL: PoolVoice[] = [
  { voiceId: 'gemini:Charon', gender: 'male', tone: 'olgun, anlatıcı' },
  { voiceId: 'gemini:Iapetus', gender: 'male', tone: 'derin' },
  { voiceId: 'gemini:Puck', gender: 'male', tone: 'genç, enerjik' },
  { voiceId: 'gemini:Algenib', gender: 'male', tone: 'sert' },
  { voiceId: 'gemini:Algieba', gender: 'male', tone: 'yumuşak' },
  { voiceId: 'gemini:Schedar', gender: 'male', tone: 'ölçülü' },
  { voiceId: 'gemini:Kore', gender: 'female', tone: 'bilge, sakin' },
  { voiceId: 'gemini:Leda', gender: 'female', tone: 'genç, canlı' },
];

export const DEFAULT_NARRATOR_VOICE = 'gemini:Charon';

// Cinsiyete uygun, kullanılmamış ilk ses; havuz biterse deterministik döngü.
export function pickVoice(gender: string, used: Set<string>): string {
  const candidates = gender === 'male' || gender === 'female' ? VOICE_POOL.filter((v) => v.gender === gender) : VOICE_POOL;
  const free = candidates.filter((v) => !used.has(v.voiceId));
  const pick = (free[0] ?? candidates[used.size % candidates.length] ?? VOICE_POOL[0]).voiceId;
  used.add(pick);
  return pick;
}
```

- [ ] **Step 4: PASS doğrula + commit**

Çalıştır: `npx vitest run tests/panel/voices-pool.test.ts` → PASS (4 test).

```bash
git add lib/voices-pool.ts tests/panel/voices-pool.test.ts
git commit -m "feat(panel): etiketli ses havuzu + deterministik ses atama"
```

---

### Task 3: LLM temel — tipler, chunk şeması, prompt kurucu

**Files:**
- Create: `lib/llm/types.ts`
- Create: `lib/llm/schema.ts`
- Create: `lib/llm/prompt.ts`
- Test: `tests/panel/llm-base.test.ts`

**Interfaces:**
- Consumes: `zod` (mevcut).
- Produces:
  - `LlmUsage { inputTokens; outputTokens }`, `LlmAnnotateRequest { system; user; jsonSchema? }`, `LlmAdapter { id; annotate(req): Promise<{ json: unknown; usage: LlmUsage }> }`
  - `llmChunkSchema` (zod; cast tipli/voice_id'siz, segments, pronunciations), `LlmCast`, `LlmChunk` tipleri; `extractJson(text): unknown`
  - `buildSystemPrompt(o: PromptOptions): string`, `buildUserPrompt(chunk, index, total): string` — **mod işaretleri sabittir:** narrator modunda `'tek anlatıcı'`, multi modunda `'çok karakterli'` metni sistem prompt'ta GEÇMEK ZORUNDA (MockLlmAdapter bunlarla mod algılar).

- [ ] **Step 1: Failing test yaz**

`tests/panel/llm-base.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { extractJson, llmChunkSchema } from '@/lib/llm/schema';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/llm/prompt';

describe('extractJson', () => {
  test('düz JSON parse', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  test('metin içinden ilk {...} bloğu', () => expect(extractJson('İşte JSON:\n```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  test('JSON yoksa Türkçe hata', () => expect(() => extractJson('json yok')).toThrow(/JSON bulunamadı/));
});

describe('llmChunkSchema', () => {
  test('geçerli chunk parse olur, bilinmeyen enum tolere edilir (catch)', () => {
    const r = llmChunkSchema.parse({
      cast: [{ character_id: 'k', display_name: 'K', gender: 'robot', age_hint: 'baby' }],
      segments: [{ speaker: 'k', type: 'şarkı', text: 'merhaba' }],
    });
    expect(r.cast[0].gender).toBe('unknown');
    expect(r.cast[0].age_hint).toBe('adult');
    expect(r.segments[0].type).toBe('narration');
    expect(r.pronunciations).toEqual([]);
  });
  test('boş segments reddedilir', () => {
    expect(() => llmChunkSchema.parse({ cast: [], segments: [] })).toThrow();
  });
});

describe('buildSystemPrompt', () => {
  test('narrator modu işareti + kurallar', () => {
    const s = buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 });
    expect(s).toContain('tek anlatıcı');
    expect(s).toContain('"narrator"');
    expect(s).toContain('ÇIKTI ŞEMASI');
  });
  test('multi modu işareti + maks karakter + tarz + talimat + önceki cast', () => {
    const s = buildSystemPrompt({
      voiceMode: 'multi', maxCharacters: 4, narrationStyle: 'gizemli',
      knownCast: [{ character_id: 'kaan', display_name: 'Kaan', gender: 'male', age_hint: 'young' }],
      instruction: 'daha az segment', prevSummary: 'v1: 10 segment',
    });
    expect(s).toContain('çok karakterli');
    expect(s).toContain('EN FAZLA 4');
    expect(s).toContain('ANLATIM TARZI: gizemli');
    expect(s).toContain('BİLİNEN KARAKTERLER');
    expect(s).toContain('KULLANICI DÜZELTMESİ');
    expect(s).toContain('ÖNCEKİ DENEME ÖZETİ: v1: 10 segment');
  });
});

describe('buildUserPrompt', () => {
  test('tek parça: metnin kendisi; çok parça: başlıklı', () => {
    expect(buildUserPrompt('metin', 0, 1)).toBe('metin');
    expect(buildUserPrompt('metin', 1, 3)).toContain('PARÇASI 2/3');
  });
});
```

- [ ] **Step 2: Fail doğrula**

Çalıştır: `npx vitest run tests/panel/llm-base.test.ts` → FAIL (modüller yok).

- [ ] **Step 3: Implementasyon**

`lib/llm/types.ts`:

```ts
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface LlmAnnotateRequest {
  system: string;      // sistem prompt (tarz + mod + kurallar + şema)
  user: string;        // chunk metni
  jsonSchema?: object; // structured output şeması (Dilim B'de devrede değil; arayüz hazır)
}
export interface LlmAdapter {
  readonly id: string;
  annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }>;
}
```

`lib/llm/schema.ts`:

```ts
import { z } from 'zod';

// LLM chunk çıktısı: cast TİPLİ ama voice_id'SİZ (sesi sistem atar), segment id'siz (sistem numaralar).
export const llmCastSchema = z.object({
  character_id: z.string().min(1),
  display_name: z.string().min(1),
  gender: z.enum(['male', 'female', 'unknown']).catch('unknown'),
  age_hint: z.enum(['child', 'young', 'adult', 'elder']).catch('adult'),
  persona: z.string().optional(),
});

export const llmSegmentSchema = z.object({
  speaker: z.string().min(1),
  type: z.enum(['narration', 'dialogue', 'thought']).catch('narration'),
  text: z.string().min(1),
  style: z.string().optional(),
  pause_after_ms: z.number().int().nonnegative().optional(),
});

export const llmChunkSchema = z.object({
  cast: z.array(llmCastSchema).default([]),
  segments: z.array(llmSegmentSchema).min(1),
  pronunciations: z.array(z.object({ term: z.string().min(1), say_as: z.string().min(1) })).default([]),
});

export type LlmCast = z.infer<typeof llmCastSchema>;
export type LlmChunk = z.infer<typeof llmChunkSchema>;

// LLM yanıtından JSON çıkar: önce doğrudan parse, sonra ilk {...} bloğu.
export function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fallback aşağıda */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('LLM yanıtında JSON bulunamadı');
  return JSON.parse(m[0]);
}
```

`lib/llm/prompt.ts`:

```ts
import type { LlmCast } from './schema';

export interface PromptOptions {
  voiceMode: 'narrator' | 'multi';
  maxCharacters: number;
  narrationStyle?: string | null;
  knownCast?: LlmCast[];
  instruction?: string;
  prevSummary?: string;
}

// DİKKAT: 'tek anlatıcı' / 'çok karakterli' işaret metinleri MockLlmAdapter'ın mod algısıdır — değiştirme.
export function buildSystemPrompt(o: PromptOptions): string {
  const parts: string[] = [
    'Sen bir sesli kitap yönetmenisin. Verilen bölüm metnini TTS ile seslendirilecek segmentlere ayır ve SADECE geçerli JSON döndür.',
    'KURALLAR:',
    '- Segmentler kısa: 1-3 cümle, tek konuşan, tek duygu.',
    '- type: "narration" (anlatım), "dialogue" (konuşma), "thought" (iç ses).',
    '- style: kısa Türkçe duygu/ton tarifi (ör. "sakin, gizemli"); yalnızca gerektiğinde.',
    '- Sahne/paragraf geçişlerinde pause_after_ms öner (200-600 ms).',
    '- Metni DEĞİŞTİRME; atlama/özetleme yok — tüm metin segmentlere dağılmalı.',
    '- Zor özel isimler için pronunciations doldur.',
  ];
  if (o.voiceMode === 'narrator') {
    parts.push('- SES MODU: tek anlatıcı. TÜM segmentlerde speaker "narrator"; cast yalnızca narrator içerir. Diyaloglar da anlatıcı tarafından ifadeli okunur (style ile belirt).');
  } else {
    parts.push(`- SES MODU: çok karakterli. Konuşan karakterleri tespit et, cast'e ekle (character_id: küçük harf ascii). EN FAZLA ${o.maxCharacters} karakter; önemsiz konuşmalar "narrator"da kalır. Anlatım her zaman "narrator".`);
    parts.push('- Her karakter için gender (male|female|unknown), age_hint (child|young|adult|elder) ve kısa persona doldur.');
  }
  if (o.narrationStyle?.trim()) parts.push(`ANLATIM TARZI: ${o.narrationStyle.trim()}`);
  if (o.knownCast?.length) parts.push(`BİLİNEN KARAKTERLER (önceki parçalardan; aynı character_id kullan): ${JSON.stringify(o.knownCast)}`);
  if (o.instruction) parts.push(`KULLANICI DÜZELTMESİ (önceki denemeye göre uygula): ${o.instruction}`);
  if (o.prevSummary) parts.push(`ÖNCEKİ DENEME ÖZETİ: ${o.prevSummary}`);
  parts.push('ÇIKTI ŞEMASI (yalnızca bu JSON):');
  parts.push('{"cast":[{"character_id":"","display_name":"","gender":"male|female|unknown","age_hint":"child|young|adult|elder","persona":""}],"segments":[{"speaker":"","type":"narration|dialogue|thought","text":"","style":"","pause_after_ms":0}],"pronunciations":[{"term":"","say_as":""}]}');
  return parts.join('\n');
}

export function buildUserPrompt(chunk: string, index: number, total: number): string {
  return total > 1 ? `BÖLÜM PARÇASI ${index + 1}/${total}:\n\n${chunk}` : chunk;
}
```

- [ ] **Step 4: PASS doğrula + commit**

Çalıştır: `npx vitest run tests/panel/llm-base.test.ts` → PASS (8 test).

```bash
git add lib/llm/types.ts lib/llm/schema.ts lib/llm/prompt.ts tests/panel/llm-base.test.ts
git commit -m "feat(panel): LLM adapter arayüzü + chunk şeması + prompt kurucu"
```

---

### Task 4: LLM adapter'lar — Mock + Gemini

**Files:**
- Create: `lib/llm/mock.ts`
- Create: `lib/llm/gemini.ts`
- Test: `tests/panel/llm-adapters.test.ts`

**Interfaces:**
- Consumes: Task 3 (`LlmAdapter`, `extractJson`); `@google/genai` (mevcut bağımlılık).
- Produces:
  - `MockLlmAdapter` — `id: 'mock-llm'`; deterministik: cümle başına segment; sistem prompt `'çok karakterli'` içeriyorsa tırnaklı cümleler `kisi1` diyaloğu olur, cast'e `kisi1` eklenir; değilse hepsi `narrator`.
  - `GeminiLlmAdapter(apiKey, model = 'gemini-2.5-flash')` — `id: 'gemini-llm:<model>'`; `systemInstruction` + `responseMimeType: 'application/json'`; 3 deneme backoff; `usageMetadata`'dan token sayıları.

- [ ] **Step 1: Failing test yaz**

`tests/panel/llm-adapters.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { MockLlmAdapter } from '@/lib/llm/mock';
import { GeminiLlmAdapter } from '@/lib/llm/gemini';
import { llmChunkSchema } from '@/lib/llm/schema';
import { buildSystemPrompt } from '@/lib/llm/prompt';

const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi. Elara gülümsedi.';

describe('MockLlmAdapter', () => {
  test('narrator modu: tüm segmentler narrator, şemaya uygun', async () => {
    const r = await new MockLlmAdapter().annotate({ system: buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 }), user: TEXT });
    const chunk = llmChunkSchema.parse(r.json);
    expect(chunk.segments.length).toBeGreaterThanOrEqual(3);
    expect(chunk.segments.every((s) => s.speaker === 'narrator')).toBe(true);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  test('multi modu: tırnaklı cümle kisi1 diyaloğu, cast 2 kişi', async () => {
    const r = await new MockLlmAdapter().annotate({ system: buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 }), user: TEXT });
    const chunk = llmChunkSchema.parse(r.json);
    expect(chunk.segments.some((s) => s.speaker === 'kisi1' && s.type === 'dialogue')).toBe(true);
    expect(chunk.cast.map((c) => c.character_id).sort()).toEqual(['kisi1', 'narrator']);
  });

  test('deterministik: aynı girdi aynı çıktı', async () => {
    const m = new MockLlmAdapter();
    const req = { system: buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 }), user: TEXT };
    expect(await m.annotate(req)).toEqual(await m.annotate(req));
  });
});

describe('GeminiLlmAdapter (ağ yok, kurulum)', () => {
  test('id ve model varsayılanı', () => {
    const a = new GeminiLlmAdapter('anahtar');
    expect(a.model).toBe('gemini-2.5-flash');
    expect(a.id).toBe('gemini-llm:gemini-2.5-flash');
    expect(new GeminiLlmAdapter('anahtar', 'baska-model').id).toBe('gemini-llm:baska-model');
  });
});
```

- [ ] **Step 2: Fail doğrula**

Çalıştır: `npx vitest run tests/panel/llm-adapters.test.ts` → FAIL.

- [ ] **Step 3: Implementasyon**

`lib/llm/mock.ts`:

```ts
import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';

// Deterministik sahte LLM (testler + ücretsiz deneme): cümle başına segment;
// 'çok karakterli' modda tırnaklı cümleler "kisi1" diyaloğu olur. Ağ yok.
export class MockLlmAdapter implements LlmAdapter {
  readonly id = 'mock-llm';
  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    const multi = req.system.includes('çok karakterli');
    const sentences = req.user.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    let hasDialogue = false;
    const segments = sentences.map((text) => {
      const dialogue = multi && /["“”«]/.test(text);
      if (dialogue) hasDialogue = true;
      return { speaker: dialogue ? 'kisi1' : 'narrator', type: dialogue ? 'dialogue' : 'narration', text };
    });
    const cast = [{ character_id: 'narrator', display_name: 'Anlatıcı', gender: 'unknown', age_hint: 'adult', persona: 'anlatıcı' }];
    if (hasDialogue) cast.push({ character_id: 'kisi1', display_name: 'Kişi 1', gender: 'male', age_hint: 'young', persona: 'genç erkek' });
    return { json: { cast, segments, pronunciations: [] }, usage: { inputTokens: Math.ceil(req.user.length / 4), outputTokens: 100 } };
  }
}
```

`lib/llm/gemini.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';
import { extractJson } from './schema';

export class GeminiLlmAdapter implements LlmAdapter {
  readonly id: string;
  readonly model: string;
  private ai: GoogleGenAI;
  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.model = model;
    this.id = `gemini-llm:${model}`;
    this.ai = new GoogleGenAI({ apiKey });
  }

  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: [{ parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            ...(req.jsonSchema ? { responseSchema: req.jsonSchema } : {}),
          },
        });
        const text = response.text ?? response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        if (!text) throw new Error(`boş yanıt (finishReason=${response.candidates?.[0]?.finishReason ?? 'yok'})`);
        const u = response.usageMetadata;
        return { json: extractJson(text), usage: { inputTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0 } };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw new Error(`Gemini LLM çağrısı başarısız: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}
```

- [ ] **Step 4: PASS doğrula + commit**

Çalıştır: `npx vitest run tests/panel/llm-adapters.test.ts` → PASS (4 test). Sonra `npm test` → tümü yeşil.

```bash
git add lib/llm/mock.ts lib/llm/gemini.ts tests/panel/llm-adapters.test.ts
git commit -m "feat(panel): Mock + Gemini LLM adapter'ları"
```

---

### Task 5: Annotation servisi

**Files:**
- Create: `lib/services/annotation.ts`
- Test: `tests/panel/annotation.test.ts`

**Interfaces:**
- Consumes: Task 1-4 üretimleri + `getChapter`, `getSetting`, `latestScript`, `saveScript`, `parseScript` (saveScript içinde).
- Produces:
  - `chunkText(raw: string, target?): string[]` — boş metinde Türkçe hata.
  - `llmAdapterFromSettings(db): LlmAdapter` — settings `llm_provider` → env `LLM_PROVIDER` → `'gemini'`; mock desteklenir; gemini için `GEMINI_API_KEY` şart.
  - `annotateChapter(db, chapterId, adapter, opts?: { instruction?: string; onProgress?: (done, total) => void }): Promise<AnnotateOutcome>` — `AnnotateOutcome { scriptId; version; segmentCount; castCount; usage: { inputTokens; outputTokens; chunks } }`.
  - Davranış sözleşmesi: zod hatasında chunk başına 1 retry (hata özeti sistem prompt'a eklenir); narrator modunda TÜM speaker'lar narrator'a zorlanır; cast dışı speaker narrator'a düşürülür; sesler §2.2 kuralıyla atanır (narrator = settings `default_voice` ?? `DEFAULT_NARRATOR_VOICE`).

- [ ] **Step 1: Failing test yaz**

`tests/panel/annotation.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter, updateChapter } from '@/lib/services/chapters';
import { latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { annotateChapter, chunkText, llmAdapterFromSettings } from '@/lib/services/annotation';
import { MockLlmAdapter } from '@/lib/llm/mock';
import type { LlmAdapter } from '@/lib/llm/types';

const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi.\n\nElara gölgeden çıktı. "Sakin ol, çocuk."';

function setup(voiceMode: 'narrator' | 'multi' = 'narrator') {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  updateChapter(db, c.id, { rawText: TEXT, narrationStyle: 'gizemli', voiceMode });
  return { db, chapterId: c.id };
}

describe('chunkText', () => {
  test('kısa metin tek parça; boş metin Türkçe hata', () => {
    expect(chunkText('merhaba dünya')).toEqual(['merhaba dünya']);
    expect(() => chunkText('   ')).toThrow(/metni boş/);
  });
  test('uzun metin paragraf sınırından bölünür', () => {
    const para = 'a'.repeat(4000);
    const chunks = chunkText([para, para, para, para].join('\n\n'), 10000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(`${para}\n\n${para}`);
  });
});

describe('annotateChapter (MockLlmAdapter)', () => {
  test('narrator modu: script yazılır, tüm speaker narrator, tek cast, source=llm', async () => {
    const { db, chapterId } = setup('narrator');
    const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(out.version).toBe(1);
    expect(out.castCount).toBe(1);
    expect(out.usage.chunks).toBe(1);
    const scr = latestScript(db, chapterId)!;
    expect(scr.source).toBe('llm');
    expect(JSON.parse(scr.usageJson!)).toMatchObject({ chunks: 1 });
    const json = JSON.parse(scr.json);
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({ character_id: 'narrator', voice_id: 'gemini:Charon', base_style: 'gizemli' });
    expect(json.segments.every((s: any) => s.speaker === 'narrator')).toBe(true);
    expect(json.segments[0].id).toBe('s1');
    expect(listSegments(db, scr.id).length).toBe(json.segments.length);
    expect(getChapter(db, chapterId)?.status).toBe('scripted');
  });

  test('multi modu: kisi1 cast\'e girer, cinsiyete uygun ses atanır (Charon hariç)', async () => {
    const { db, chapterId } = setup('multi');
    const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(out.castCount).toBe(2);
    const json = JSON.parse(latestScript(db, chapterId)!.json);
    const kisi1 = json.cast.find((c: any) => c.character_id === 'kisi1');
    expect(kisi1.voice_id).toMatch(/^gemini:/);
    expect(kisi1.voice_id).not.toBe('gemini:Charon'); // anlatıcının sesi kullanılmış sayılır
    expect(kisi1.base_style).toBe('genç erkek');
    expect(json.segments.some((s: any) => s.speaker === 'kisi1')).toBe(true);
  });

  test('default_voice ayarı anlatıcı sesini değiştirir', async () => {
    const { db, chapterId } = setup('narrator');
    setSetting(db, 'default_voice', 'gemini:Iapetus');
    await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(JSON.parse(latestScript(db, chapterId)!.json).cast[0].voice_id).toBe('gemini:Iapetus');
  });

  test('bozuk ilk yanıt → retry ile düzelir; retry\'da hata özeti prompt\'a eklenir', async () => {
    const { db, chapterId } = setup('narrator');
    let call = 0;
    const systems: string[] = [];
    const inner = new MockLlmAdapter();
    const flaky: LlmAdapter = {
      id: 'flaky',
      annotate(req) {
        systems.push(req.system);
        if (++call === 1) return Promise.resolve({ json: { bozuk: true }, usage: { inputTokens: 1, outputTokens: 1 } });
        return inner.annotate(req);
      },
    };
    const out = await annotateChapter(db, chapterId, flaky);
    expect(out.version).toBe(1);
    expect(call).toBe(2);
    expect(systems[1]).toContain('ÖNCEKİ DENEMENİN HATASI');
  });

  test('iki deneme de bozuksa Türkçe hata, script yazılmaz', async () => {
    const { db, chapterId } = setup('narrator');
    const broken: LlmAdapter = { id: 'broken', annotate: () => Promise.resolve({ json: { bozuk: true }, usage: { inputTokens: 1, outputTokens: 1 } }) };
    await expect(annotateChapter(db, chapterId, broken)).rejects.toThrow(/doğrulanamadı/);
    expect(latestScript(db, chapterId)).toBeUndefined();
  });

  test('cast dışı speaker narrator\'a düşürülür (dayanıklılık)', async () => {
    const { db, chapterId } = setup('multi');
    const weird: LlmAdapter = {
      id: 'weird',
      annotate: () => Promise.resolve({
        json: {
          cast: [{ character_id: 'narrator', display_name: 'Anlatıcı', gender: 'unknown', age_hint: 'adult' }],
          segments: [{ speaker: 'hayalet', type: 'dialogue', text: 'buu' }],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    await annotateChapter(db, chapterId, weird);
    expect(JSON.parse(latestScript(db, chapterId)!.json).segments[0].speaker).toBe('narrator');
  });

  test('instruction: sistem prompt\'a düzeltme + önceki özet girer, versiyon artar', async () => {
    const { db, chapterId } = setup('narrator');
    await annotateChapter(db, chapterId, new MockLlmAdapter());
    const systems: string[] = [];
    const spy: LlmAdapter = { id: 'spy', annotate(req) { systems.push(req.system); return new MockLlmAdapter().annotate(req); } };
    const out = await annotateChapter(db, chapterId, spy, { instruction: 'daha az segment' });
    expect(out.version).toBe(2);
    expect(systems[0]).toContain('KULLANICI DÜZELTMESİ');
    expect(systems[0]).toContain('ÖNCEKİ DENEME ÖZETİ: v1:');
  });

  test('onProgress chunk ilerlemesini bildirir', async () => {
    const { db, chapterId } = setup('narrator');
    const progress: [number, number][] = [];
    await annotateChapter(db, chapterId, new MockLlmAdapter(), { onProgress: (d, t) => progress.push([d, t]) });
    expect(progress).toEqual([[1, 1]]);
  });
});

describe('llmAdapterFromSettings', () => {
  test('llm_provider=mock MockLlmAdapter döner; gemini + anahtarsız Türkçe hata', () => {
    const db = createDb(':memory:');
    setSetting(db, 'llm_provider', 'mock');
    expect(llmAdapterFromSettings(db).id).toBe('mock-llm');
    setSetting(db, 'llm_provider', 'gemini');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try { expect(() => llmAdapterFromSettings(db)).toThrow(/GEMINI_API_KEY/); }
    finally { if (saved) process.env.GEMINI_API_KEY = saved; }
  });
});
```

- [ ] **Step 2: Fail doğrula**

Çalıştır: `npx vitest run tests/panel/annotation.test.ts` → FAIL (modül yok).

- [ ] **Step 3: Implementasyon**

`lib/services/annotation.ts`:

```ts
import type { Db } from '../db/client';
import { getSetting } from './settings';
import { getChapter } from './chapters';
import { latestScript, saveScript } from './scripts';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt';
import { llmChunkSchema, type LlmCast, type LlmChunk } from '../llm/schema';
import { GeminiLlmAdapter } from '../llm/gemini';
import { MockLlmAdapter } from '../llm/mock';
import type { LlmAdapter } from '../llm/types';
import { DEFAULT_NARRATOR_VOICE, pickVoice } from '../voices-pool';

export interface AnnotateOutcome {
  scriptId: string; version: number; segmentCount: number; castCount: number;
  usage: { inputTokens: number; outputTokens: number; chunks: number };
}

const CHUNK_TARGET = 12_000; // karakter; Gemini flash çıktı limitine güvenli mesafe

export function llmAdapterFromSettings(db: Db): LlmAdapter {
  const provider = getSetting(db, 'llm_provider') ?? process.env.LLM_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockLlmAdapter();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil (.env)');
  return new GeminiLlmAdapter(key, getSetting(db, 'llm_model') ?? process.env.LLM_MODEL);
}

// Paragraf sınırından ~target karakterlik parçalar; çoğu bölüm tek parça.
export function chunkText(raw: string, target = CHUNK_TARGET): string[] {
  const text = raw.trim();
  if (!text) throw new Error('Bölüm metni boş — önce ham metni kaydedin');
  if (text.length <= target) return [text];
  const chunks: string[] = [];
  let cur = '';
  for (const p of text.split(/\n\s*\n/)) {
    if (cur && cur.length + p.length + 2 > target) { chunks.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Tek chunk: LLM çağrısı + zod doğrulama; hatada 1 retry (hata özeti sistem prompt'a eklenir).
async function annotateChunk(adapter: LlmAdapter, system: string, user: string): Promise<{ chunk: LlmChunk; usage: { inputTokens: number; outputTokens: number } }> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sys = attempt === 1 ? system : `${system}\n\nÖNCEKİ DENEMENİN HATASI: ${lastErr}\nŞemaya birebir uy, yalnızca JSON döndür.`;
    try {
      const r = await adapter.annotate({ system: sys, user });
      return { chunk: llmChunkSchema.parse(r.json), usage: r.usage };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`LLM çıktısı doğrulanamadı: ${lastErr}`);
}

// Ham metin + tarz + ses modu → LLM → doğrulanmış script (scripts.source='llm').
export async function annotateChapter(
  db: Db, chapterId: string, adapter: LlmAdapter,
  opts?: { instruction?: string; onProgress?: (done: number, total: number) => void },
): Promise<AnnotateOutcome> {
  const chapter = getChapter(db, chapterId);
  if (!chapter) throw new Error('Bölüm bulunamadı');
  const voiceMode = chapter.voiceMode === 'multi' ? ('multi' as const) : ('narrator' as const);
  const chunks = chunkText(chapter.rawText);

  // Yeniden üretimde önceki denemenin kısa özeti prompt'a girer.
  let prevSummary: string | undefined;
  if (opts?.instruction) {
    const prev = latestScript(db, chapterId);
    if (prev) {
      const pj = JSON.parse(prev.json) as { cast?: { character_id: string }[]; segments?: unknown[] };
      prevSummary = `v${prev.version}: ${pj.segments?.length ?? 0} segment, karakterler: ${pj.cast?.map((c) => c.character_id).join(', ') ?? '-'}`;
    }
  }

  const knownCast: LlmCast[] = [];
  const allSegments: LlmChunk['segments'] = [];
  const pron = new Map<string, string>();
  let inputTokens = 0, outputTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const system = buildSystemPrompt({
      voiceMode, maxCharacters: chapter.maxCharacters, narrationStyle: chapter.narrationStyle,
      knownCast: knownCast.length ? knownCast : undefined,
      instruction: opts?.instruction, prevSummary,
    });
    const { chunk, usage } = await annotateChunk(adapter, system, buildUserPrompt(chunks[i], i, chunks.length));
    for (const c of chunk.cast) if (!knownCast.some((k) => k.character_id === c.character_id)) knownCast.push(c); // ilk kazanır
    allSegments.push(...chunk.segments);
    for (const p of chunk.pronunciations) if (!pron.has(p.term)) pron.set(p.term, p.say_as);
    inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
    opts?.onProgress?.(i + 1, chunks.length);
  }

  // Ses ataması: anlatıcı = default_voice ?? DEFAULT_NARRATOR_VOICE; karakterler havuzdan (§2.2).
  const narratorVoice = getSetting(db, 'default_voice') ?? DEFAULT_NARRATOR_VOICE;
  const used = new Set<string>([narratorVoice]);
  const cast = [
    { character_id: 'narrator', display_name: 'Anlatıcı', voice_id: narratorVoice, base_style: chapter.narrationStyle ?? undefined },
    ...(voiceMode === 'multi'
      ? knownCast.filter((c) => c.character_id !== 'narrator').map((c) => ({
          character_id: c.character_id, display_name: c.display_name,
          voice_id: pickVoice(c.gender, used), base_style: c.persona,
        }))
      : []),
  ];
  const castIds = new Set(cast.map((c) => c.character_id));
  const segs = allSegments.map((s, i) => ({
    id: `s${i + 1}`,
    // narrator modunda veya cast dışı konuşmacıda anlatıcıya düşür (dayanıklılık).
    speaker: voiceMode === 'narrator' || !castIds.has(s.speaker) ? 'narrator' : s.speaker,
    type: s.type, text: s.text, style: s.style, pause_after_ms: s.pause_after_ms,
  }));
  const script = {
    schema_version: '1.0', series: chapter.title, season: 1, episode: chapter.position,
    title: chapter.title, language: 'tr-TR', cast, segments: segs,
    ...(pron.size ? { pronunciations: [...pron].map(([term, say_as]) => ({ term, say_as })) } : {}),
  };

  const usage = { inputTokens, outputTokens, chunks: chunks.length };
  const saved = saveScript(db, chapterId, JSON.stringify(script), 'llm', JSON.stringify(usage));
  return { ...saved, castCount: cast.length, usage };
}
```

Not: retry'lı başarısız denemenin token'ları sayılmaz (yalnızca başarılı yanıtın usage'ı) — bilinçli sadeleştirme.

- [ ] **Step 4: PASS doğrula + tüm testler**

Çalıştır: `npx vitest run tests/panel/annotation.test.ts` → PASS (10 test). `npm test` → tümü yeşil.

- [ ] **Step 5: Commit**

```bash
git add lib/services/annotation.ts tests/panel/annotation.test.ts
git commit -m "feat(panel): annotation servisi — chunk + LLM + zod-retry + ses atama"
```

---

### Task 6: API rotaları — annotate SSE, cast-voice, PATCH/GET genişletme

**Files:**
- Create: `app/api/chapters/[id]/annotate/route.ts`
- Create: `app/api/chapters/[id]/cast-voice/route.ts`
- Modify: `app/api/chapters/[id]/route.ts` (PATCH: voiceMode/maxCharacters; GET: cast + script.source/usage)
- Test: `tests/panel/api-annotate.test.ts`

**Interfaces:**
- Consumes: Task 1+5 servisleri; mevcut `getDb`/`setDbForTests`.
- Produces (UI sözleşmesi):
  - `POST /api/chapters/:id/annotate` gövde `{ instruction?: string }` → **SSE:** `progress {chunk, totalChunks}` · `done {scriptId, version, segmentCount, castCount, usage}` · `error {message}`.
  - `POST /api/chapters/:id/cast-voice` gövde `{ characterId, voiceId }` → `{ scriptId, version }` | 400 `{ error }`.
  - `PATCH /api/chapters/:id` ek alanlar: `voiceMode` (`'narrator'|'multi'` doğrulanır), `maxCharacters` (≥1 tamsayıya yuvarlanır).
  - `GET /api/chapters/:id` yanıtına eklenir: `cast: CastMember[]` (en güncel script'ten; yoksa `[]`), `script.source`, `script.usage` (usageJson parse; yoksa `null`).

- [ ] **Step 1: Failing test yaz**

`tests/panel/api-annotate.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, updateChapter } from '@/lib/services/chapters';
import { setSetting } from '@/lib/services/settings';
import * as annotateRoute from '@/app/api/chapters/[id]/annotate/route';
import * as castVoiceRoute from '@/app/api/chapters/[id]/cast-voice/route';
import * as chapterRoute from '@/app/api/chapters/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi.';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); setSetting(db, 'llm_provider', 'mock'); });

function mkChapter(voiceMode = 'multi') {
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B' });
  updateChapter(db, c.id, { rawText: TEXT, voiceMode });
  return c.id;
}

describe('annotate SSE', () => {
  test('mock LLM ile progress + done; sonra GET cast ve usage döner', async () => {
    const id = mkChapter();
    const res = await annotateRoute.POST(jsonReq('POST', {}), ctx(id));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await new Response(res.body).text();
    expect(body).toContain('event: progress');
    expect(body).toContain('event: done');
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]);
    expect(done.castCount).toBe(2);

    const detail = await (await chapterRoute.GET(jsonReq('GET'), ctx(id))).json();
    expect(detail.script.source).toBe('llm');
    expect(detail.script.usage.chunks).toBe(1);
    expect(detail.cast.map((c: any) => c.character_id).sort()).toEqual(['kisi1', 'narrator']);
  });

  test('boş metin: SSE error olayı', async () => {
    const id = mkChapter();
    updateChapter(db, id, { rawText: '' });
    const body = await new Response((await annotateRoute.POST(jsonReq('POST', {}), ctx(id))).body).text();
    expect(body).toContain('event: error');
    expect(body).toContain('metni boş');
  });
});

describe('cast-voice', () => {
  test('ses değişir, yeni versiyon; eksik gövde 400; bilinmeyen karakter 400', async () => {
    const id = mkChapter();
    await new Response((await annotateRoute.POST(jsonReq('POST', {}), ctx(id))).body).text();

    const ok = await castVoiceRoute.POST(jsonReq('POST', { characterId: 'kisi1', voiceId: 'gemini:Puck' }), ctx(id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);

    expect((await castVoiceRoute.POST(jsonReq('POST', {}), ctx(id))).status).toBe(400);
    expect((await castVoiceRoute.POST(jsonReq('POST', { characterId: 'hayalet', voiceId: 'gemini:Puck' }), ctx(id))).status).toBe(400);
  });
});

describe('PATCH voiceMode/maxCharacters', () => {
  test('geçerli değerler kaydedilir; geçersiz voiceMode yok sayılır', async () => {
    const id = mkChapter('narrator');
    const r1 = await (await chapterRoute.PATCH(jsonReq('PATCH', { voiceMode: 'multi', maxCharacters: 3 }), ctx(id))).json();
    expect(r1.voiceMode).toBe('multi');
    expect(r1.maxCharacters).toBe(3);
    const r2 = await (await chapterRoute.PATCH(jsonReq('PATCH', { voiceMode: 'saçma' }), ctx(id))).json();
    expect(r2.voiceMode).toBe('multi'); // değişmedi
  });
});
```

- [ ] **Step 2: Fail doğrula**

Çalıştır: `npx vitest run tests/panel/api-annotate.test.ts` → FAIL.

- [ ] **Step 3: Rotaları yaz**

`app/api/chapters/[id]/annotate/route.ts`:

```ts
import { getDb } from '@/lib/db/client';
import { annotateChapter, llmAdapterFromSettings } from '@/lib/services/annotation';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const instruction = typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim() : undefined;
  const db = getDb();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const adapter = llmAdapterFromSettings(db);
        const out = await annotateChapter(db, id, adapter, {
          instruction,
          onProgress: (done, total) => send('progress', { chunk: done, totalChunks: total }),
        });
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

`app/api/chapters/[id]/cast-voice/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { changeCastVoice } from '@/lib/services/scripts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.characterId !== 'string' || typeof body.voiceId !== 'string') {
    return NextResponse.json({ error: 'characterId ve voiceId gerekli' }, { status: 400 });
  }
  try {
    return NextResponse.json(changeCastVoice(getDb(), id, body.characterId, body.voiceId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/chapters/[id]/route.ts` — GET ve PATCH şu hale gelir (DELETE aynı):

```ts
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const chapter = getChapter(db, id);
  if (!chapter) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  const scr = latestScript(db, id);
  const segments = scr ? listSegments(db, scr.id) : [];
  let cast: unknown[] = [];
  if (scr) { try { cast = JSON.parse(scr.json).cast ?? []; } catch { /* bozuk json'u yok say */ } }
  return NextResponse.json({
    chapter,
    script: scr ? {
      id: scr.id, version: scr.version, segmentCount: segments.length,
      source: scr.source, usage: scr.usageJson ? JSON.parse(scr.usageJson) : null,
    } : null,
    cast,
    segments,
    renders: listRenders(db, id),
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateChapter>[2] = { title: body.title, rawText: body.rawText, narrationStyle: body.narrationStyle };
  if (typeof body.position === 'number') patch.position = body.position;
  if (body.voiceMode === 'narrator' || body.voiceMode === 'multi') patch.voiceMode = body.voiceMode;
  if (typeof body.maxCharacters === 'number' && body.maxCharacters >= 1) patch.maxCharacters = Math.floor(body.maxCharacters);
  const updated = updateChapter(getDb(), id, patch);
  if (!updated) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: PASS + build doğrula**

Çalıştır: `npx vitest run tests/panel/api-annotate.test.ts` → PASS (5 test). `npm run build && npm test` → temiz + tümü yeşil.

- [ ] **Step 5: Commit**

```bash
git add app/api/chapters/ tests/panel/api-annotate.test.ts
git commit -m "feat(panel): annotate SSE + cast-voice rotaları; chapter GET/PATCH genişletme"
```

---

### Task 7: UI — çalışma alanı güncellemesi

**Files:**
- Modify: `app/chapters/[id]/page.tsx` (aşağıdaki tam içerikle DEĞİŞTİR)

**Interfaces:**
- Consumes: Task 6 API sözleşmeleri; `VOICE_POOL` (`@/lib/voices-pool` — düz veri, client'ta import edilebilir).
- Produces: Ham metin kartında ses modu seçici + "Script üret (LLM)"; script kartında cast listesi (ses düzeltme) + ek talimat + "Yeniden üret" + usage.

- [ ] **Step 1: Sayfayı komple değiştir**

`app/chapters/[id]/page.tsx` tam içerik:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { VOICE_POOL } from '@/lib/voices-pool';

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
      <p><Link href={`/projects/${chapter.projectId}`}>← Bölümler</Link></p>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2>Ham metin + anlatım</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Bölümün ham metni" /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder="Anlatım tarzı (ör. sakin, gizemli, üçüncü şahıs)" /></p>
        <p className="row">
          <select value={voiceMode} onChange={(e) => setVoiceMode(e.target.value)} style={{ maxWidth: '14rem' }}>
            <option value="narrator">Tek anlatıcı</option>
            <option value="multi">Çok karakterli</option>
          </select>
          {voiceMode === 'multi' && (
            <label className="row muted">maks. karakter:
              <input type="number" min={1} max={12} value={maxCharacters} onChange={(e) => setMaxCharacters(Number(e.target.value) || 6)} style={{ width: '4.5rem' }} />
            </label>
          )}
        </p>
        <p className="row">
          <button className="ghost" onClick={saveText}>Kaydet</button>
          <button onClick={() => annotate(false)} disabled={annState.busy || !rawText.trim()}>
            {annState.busy ? 'Üretiliyor…' : 'Script üret (LLM)'}
          </button>
          {annState.busy && annState.totalChunks > 0 && <span className="muted">{annState.chunk}/{annState.totalChunks} parça</span>}
        </p>
        {annState.busy && annState.totalChunks > 1 && <progress value={annState.chunk} max={annState.totalChunks} />}
        {annState.err && <p className="err">{annState.err}</p>}
      </div>

      <div className="card">
        <h2>
          Seslendirme script’i{' '}
          {script && (
            <span className="muted">
              (v{script.version}, {script.segmentCount} segment, {script.source === 'llm' ? 'LLM' : 'elle'}
              {script.usage ? `, ${script.usage.inputTokens}+${script.usage.outputTokens} token` : ''})
            </span>
          )}
        </h2>

        {cast.length > 0 && (
          <table>
            <thead><tr><th>Karakter</th><th>Ton</th><th>Ses</th></tr></thead>
            <tbody>
              {cast.map((c) => (
                <tr key={c.character_id}>
                  <td>{c.display_name}</td>
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
            <button onClick={() => annotate(true)} disabled={annState.busy}>Yeniden üret</button>
          </p>
        )}

        <details>
          <summary className="muted">Elle JSON yapıştır (gelişmiş)</summary>
          <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder="JSON script’i buraya yapıştır" /></p>
          <button onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
        </details>
        {scriptErr && <p className="err">{scriptErr}</p>}
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

- [ ] **Step 2: Build + tüm testler**

Çalıştır: `npm run build && npm test`
Beklenen: build temiz, tüm testler yeşil.

- [ ] **Step 3: Headless smoke (mock LLM + mock TTS — ücretsiz, ağ yok)**

Git Bash ile (commit edilmiş `.env`'e DOKUNMA; env inline):
1. `LLM_PROVIDER=mock TTS_PROVIDER=mock DATA_DIR=$(mktemp -d) npx next dev -p 3100 &` → hazır olana dek `curl -s http://localhost:3100/api/projects` bekle.
2. curl ile: proje + bölüm oluştur; `PATCH` ile `rawText` (tırnaklı diyalog içeren Türkçe metin) + `voiceMode='multi'`.
3. `POST /api/chapters/:id/annotate` (`{}` gövde) → yanıt metninde `event: progress` ve `event: done`; done'da `castCount: 2`.
4. `GET /api/chapters/:id` → `script.source === 'llm'`, `cast` 2 kişi, `segments` dolu.
5. `POST /api/chapters/:id/cast-voice` `{characterId:'kisi1', voiceId:'gemini:Puck'}` → `version: 2`.
6. `POST /api/chapters/:id/generate` → SSE done; `GET /api/audio/<renderPath>` → 200.
7. `curl -s http://localhost:3100/` → HTML `Projeler` içerir. Dev server'ı kapat, temp dizini sil.

Beklenen: hepsi geçer; geçmeyen varsa düzelt (superpowers:systematic-debugging), sonra commit.

- [ ] **Step 4: Commit**

```bash
git add app/chapters/
git commit -m "feat(panel): çalışma alanı — ses modu, LLM script üretimi, cast ses düzeltme, yeniden üret"
```

---

### Task 8: Dokümantasyon — README, .env.example, CLAUDE.md

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** — (dokümantasyon; önceki task'ların davranışını yansıtır)

- [ ] **Step 1: .env.example güncelle**

`# İsteğe bağlı: TTS ayarları` bloğundan SONRA ekle:

```
# İsteğe bağlı: LLM (metin → script) ayarları
# LLM_PROVIDER=gemini        # gemini | mock (mock = ücretsiz test)
# LLM_MODEL=gemini-2.5-flash
```

- [ ] **Step 2: README.md güncelle**

1. "Durum" listesinde `⬜ LLM annotation ...` satırını şu İKİ satırla değiştir:

```markdown
- ✅ LLM annotation: ham metin + anlatım tarzı + ses modu → otomatik script (Gemini, BYO-key); ek talimatla yeniden üretme; cast ses düzeltme
- ⬜ Sağlam üretim kuyruğu (tek-segment yeniden üretme, cache, maliyet), PWA oynatıcı
```

2. "Kullanım" bölümünü şununla değiştir:

```markdown
## Kullanım

1. Panelde proje → bölüm oluştur, ham metnini yapıştır; anlatım tarzını ve ses modunu (tek anlatıcı / çok karakterli) seç.
2. **"Script üret (LLM)"** → sistem metni segmentlere ayırır, duygu/stil etiketler, karakterlere havuzdan ses atar. Beğenmezsen ek talimat yazıp **"Yeniden üret"**; karakter sesini listeden değiştir.
3. "Üret" → segment segment TTS + birleştirme → tarayıcıda dinle.

Ücretsiz deneme: `.env`'de `TTS_PROVIDER=mock` ve `LLM_PROVIDER=mock` (API çağrısı yapmaz). Elle JSON script yapıştırma "gelişmiş" bölümünde durur (şema: `docs/superpowers/specs/2026-07-13-webnovel-tts-design.md` §6).
```

3. "Bilinen kısıtlar" listesine ekle:

```markdown
- LLM annotation varsayılanı `gemini-2.5-flash` (ücretsiz kota, TTS kotasından ayrı); `LLM_MODEL` ile değiştirilebilir.
```

- [ ] **Step 3: CLAUDE.md güncelle**

1. "Ne yapıldı / ne kaldı" bölümünde Dilim B satırını şununla değiştir:

```markdown
- ✅ **Dilim B — LLM annotation** (`docs/superpowers/specs/2026-07-16-panel-slice-b-llm-annotation-design.md`, plan: `docs/superpowers/plans/2026-07-16-panel-slice-b-llm-annotation.md`): provider-agnostic LLM adapter (Gemini + Mock), ses modu (tek anlatıcı / çok karakterli + maks. karakter), chunk'lama + zod-retry, ses havuzundan otomatik atama, ek talimatla yeniden üretme, cast ses düzeltme, usage/token kaydı.
```

2. Dilim C satırının sonuna ` SONRAKİ.` ekle (B'den kaldır — B satırında zaten yok artık).

3. "Sonraki oturum için öneri" bölümünü şununla değiştir:

```markdown
## Sonraki oturum için öneri

Dilim C (TTS üretim hattı: DB-backed kuyruk, tek-segment yeniden üretme + segment-başı ses dosyaları, content-hash cache, maliyet, RPM/RPD ilerleme) için brainstorming/writing-plans. RPD kotası hâlâ kritik (Bilinen kısıtlar #1) — hacim öncesi faturalamalı Gemini anahtarı veya Chirp adapter kararı gündemde. Ertelenmiş minorlar: generate SSE cancel/abort (C'de core AbortSignal ile), PWA statik varlık auth (D'de).
```

- [ ] **Step 4: Son doğrulama + commit**

Çalıştır: `npm run build && npm test` → temiz + yeşil. `git status` → yalnızca bu 3 dosya.

```bash
git add .env.example README.md CLAUDE.md
git commit -m "docs: Dilim B durumu — LLM annotation kullanımı + env örnekleri"
```

---

## Doğrulama Özeti

| Kontrol | Komut | Beklenen |
|---|---|---|
| Tüm testler | `npm test` | Eski 62 + yeni ~32 test PASS |
| Build | `npm run build` | Hatasız |
| Uçtan uca (headless) | Task 7 Step 3 | mock LLM+TTS ile annotate→cast-voice→generate→mp3 |
| Ağ hijyeni | testlerde gerçek API çağrısı yok | MockLlmAdapter/MockAdapter |
