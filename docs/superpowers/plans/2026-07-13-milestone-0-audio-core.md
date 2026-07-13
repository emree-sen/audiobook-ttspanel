# Audio Core + Bake-off CLI — Implementation Plan (Plan ① / 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ham bir JSON "seslendirme scripti"ni alıp, her segmenti TTS ile seslendiren, parçaları birleştirip tek bir `episode.mp3` üreten ve maliyeti raporlayan, saf TypeScript bir çekirdek + CLI kurmak — böylece Türkçe kaliteyi (bake-off) gerçek çıktıyla doğrulayabilelim.

**Architecture:** Framework-bağımsız `src/core/` çekirdeği: zod şema → segment listesi → `TtsAdapter` (Gemini veya Mock) → PCM birleştirme + sessizlik → tek WAV → ffmpeg ile mp3. Bir `src/cli/generate.ts` bu boru hattını komut satırından çalıştırır. Bulut/DB yok; bu çekirdek Plan ③'teki worker tarafından aynen tekrar kullanılacak.

**Tech Stack:** Node ≥20 (ESM), TypeScript, `tsx` (TS çalıştırma), `vitest` (test), `zod` (şema), `@google/genai` (Gemini TTS), `ffmpeg-static` (ffmpeg ikilisi).

## Global Constraints

- Node.js ≥ 20, ESM modülleri (`"type": "module"` in package.json).
- Dil: kod/isimler İngilizce (camelCase); JSON script anahtarları **snake_case** (spec §6 ile birebir: `schema_version`, `character_id`, `voice_id`, `pause_after_ms`, `say_as`). zod snake_case okur, camelCase iç tiplere `transform` eder.
- TTS Faz 1 modeli: `gemini-2.5-flash-preview-tts`. Ses formatı Gemini'den 24000 Hz, 16-bit, mono PCM.
- Gemini fiyatı (maliyet hesabı için): metin girişi $0.50 / 1M token, ses çıkışı $10.00 / 1M token. Ses çıkışı ≈ 25 token/sn.
- Gizli anahtarlar `.env`'de (`GEMINI_API_KEY`); repoya girmez (`.gitignore` zaten kapsıyor).
- Her task TDD: önce başarısız test → çalıştır (fail gör) → minimal implementasyon → çalıştır (pass gör) → commit.
- Test komutu: `npx vitest run <dosya>`. Tüm testler: `npx vitest run`.

## File Structure

```
package.json                     # ESM, scripts, deps
tsconfig.json                    # strict TS, ESM, Node20
vitest.config.ts                 # test config
.env.example                     # GEMINI_API_KEY=
src/core/
  types.ts                       # tüm paylaşılan TS tipleri + TtsAdapter arayüzü
  schema.ts                      # zod şema + parseScript()
  voices.ts                      # resolveVoice(), validateSpeakers()
  cost.ts                        # computeGeminiCost(), formatUsd()
  audio/wav.ts                   # pcmToWav(), wavToPcm(), makeSilencePcm()
  audio/stitch.ts                # concatSegmentsToWav(), wavToMp3()
  tts/mock.ts                    # MockAdapter (test/CI, gerçek API yok)
  tts/gemini.ts                  # GeminiAdapter (gerçek TTS)
  orchestrator.ts                # generateEpisode(script, adapter)
src/cli/generate.ts              # CLI: JSON script → episode.mp3 + rapor
fixtures/sample-tr.json          # Türkçe bake-off scripti
tests/                           # yukarıdakileri birebir yansıtır
```

---

### Task 1: Proje iskeleti (scaffold)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: (yok — ilk task)
- Produces: çalışan `npx vitest run` ve `npx tsx` ortamı; ESM+TS derleme.

- [ ] **Step 1: `package.json` oluştur**

```json
{
  "name": "webnovel-tts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "generate": "tsx src/cli/generate.ts"
  },
  "dependencies": {
    "@google/genai": "^1.9.0",
    "ffmpeg-static": "^5.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` oluştur**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: `vitest.config.ts` ve `.env.example` oluştur**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
```

`.env.example`:
```
GEMINI_API_KEY=
```

- [ ] **Step 4: Bağımlılıkları kur ve smoke testi yaz**

Run: `npm install`

`tests/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('ortam çalışıyor', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 5: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/smoke.test.ts`
Expected: PASS (1 passed)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example tests/smoke.test.ts package-lock.json
git commit -m "chore: proje iskeleti (TS + vitest + tsx)"
```

---

### Task 2: JSON script şeması + tipler (zod)

**Files:**
- Create: `src/core/types.ts`, `src/core/schema.ts`
- Test: `tests/core/schema.test.ts`

**Interfaces:**
- Consumes: (yok)
- Produces:
  - `types.ts`: `SegmentType`, `CastMember`, `Pronunciation`, `ScriptSegment`, `VoiceoverScript`, `ResolvedVoice`, `TtsSegmentRequest`, `TtsCost`, `TtsResult`, `TtsAdapter` (aşağıdaki imzalarla).
  - `schema.ts`: `parseScript(json: unknown): VoiceoverScript` — geçersizse `ZodError` fırlatır.

- [ ] **Step 1: `src/core/types.ts` yaz (tüm paylaşılan tipler)**

```ts
export type SegmentType = 'narration' | 'dialogue' | 'thought';

export interface CastMember { characterId: string; displayName: string; voiceId: string; baseStyle?: string; }
export interface Pronunciation { term: string; sayAs: string; }
export interface ScriptSegment {
  id: string; speaker: string; type: SegmentType; text: string;
  style?: string; tags?: string[]; pauseAfterMs?: number;
}
export interface VoiceoverScript {
  schemaVersion: string; series: string; season: number; episode: number;
  title: string; language: string; cast: CastMember[]; segments: ScriptSegment[];
  pronunciations?: Pronunciation[];
}

export interface ResolvedVoice { provider: string; providerVoice: string; }
export interface TtsSegmentRequest {
  text: string; voice: ResolvedVoice; language: string;
  style?: string; tags?: string[]; pronunciations?: Pronunciation[];
}
export interface TtsCost { unit: 'audio_tokens' | 'chars'; amount: number; usd?: number; }
export interface TtsResult { audio: Buffer; format: 'wav' | 'mp3' | 'pcm'; durationMs: number; cost: TtsCost; }
export interface TtsAdapter { readonly id: string; synthesize(req: TtsSegmentRequest): Promise<TtsResult>; }
```

- [ ] **Step 2: Başarısız test yaz**

`tests/core/schema.test.ts`:
```ts
import { expect, test } from 'vitest';
import { parseScript } from '../../src/core/schema.js';

const valid = {
  schema_version: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [{ character_id: 'narrator', display_name: 'Anlatıcı', voice_id: 'gemini:Charon' }],
  segments: [{ id: 's1', speaker: 'narrator', type: 'narration', text: 'Merhaba.', pause_after_ms: 200 }],
};

test('geçerli scripti camelCase tiplere çevirir', () => {
  const s = parseScript(valid);
  expect(s.schemaVersion).toBe('1.0');
  expect(s.cast[0].characterId).toBe('narrator');
  expect(s.cast[0].voiceId).toBe('gemini:Charon');
  expect(s.segments[0].pauseAfterMs).toBe(200);
});

test('eksik zorunlu alanı reddeder', () => {
  const bad = { ...valid, segments: [{ id: 's1', speaker: 'narrator', type: 'narration' }] };
  expect(() => parseScript(bad)).toThrow();
});

test('geçersiz segment type reddeder', () => {
  const bad = { ...valid, segments: [{ id: 's1', speaker: 'narrator', type: 'singing', text: 'x' }] };
  expect(() => parseScript(bad)).toThrow();
});
```

- [ ] **Step 3: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/schema.test.ts`
Expected: FAIL ("Cannot find module .../schema.js" veya `parseScript is not a function`)

- [ ] **Step 4: `src/core/schema.ts` yaz**

```ts
import { z } from 'zod';
import type { VoiceoverScript } from './types.js';

const castSchema = z.object({
  character_id: z.string().min(1),
  display_name: z.string().min(1),
  voice_id: z.string().min(1),
  base_style: z.string().optional(),
}).transform((c) => ({ characterId: c.character_id, displayName: c.display_name, voiceId: c.voice_id, baseStyle: c.base_style }));

const segmentSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  type: z.enum(['narration', 'dialogue', 'thought']),
  text: z.string().min(1),
  style: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pause_after_ms: z.number().int().nonnegative().optional(),
}).transform((s) => ({ id: s.id, speaker: s.speaker, type: s.type, text: s.text, style: s.style, tags: s.tags, pauseAfterMs: s.pause_after_ms }));

const pronSchema = z.object({ term: z.string(), say_as: z.string() })
  .transform((p) => ({ term: p.term, sayAs: p.say_as }));

const scriptSchema = z.object({
  schema_version: z.string(),
  series: z.string(), season: z.number().int(), episode: z.number().int(),
  title: z.string(), language: z.string(),
  cast: z.array(castSchema).min(1),
  segments: z.array(segmentSchema).min(1),
  pronunciations: z.array(pronSchema).optional(),
}).transform((s) => ({
  schemaVersion: s.schema_version, series: s.series, season: s.season, episode: s.episode,
  title: s.title, language: s.language, cast: s.cast, segments: s.segments, pronunciations: s.pronunciations,
}));

export function parseScript(json: unknown): VoiceoverScript {
  return scriptSchema.parse(json) as VoiceoverScript;
}
```

- [ ] **Step 5: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/schema.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/schema.ts tests/core/schema.test.ts
git commit -m "feat(core): JSON seslendirme scripti şeması ve tipleri"
```

---

### Task 3: Ses çözümleme + konuşmacı doğrulama

**Files:**
- Create: `src/core/voices.ts`
- Test: `tests/core/voices.test.ts`

**Interfaces:**
- Consumes: `VoiceoverScript`, `CastMember`, `ResolvedVoice`, `ScriptSegment` (types.ts)
- Produces:
  - `parseVoiceId(voiceId: string): ResolvedVoice` — `"gemini:Charon"` → `{ provider:'gemini', providerVoice:'Charon' }`; iki nokta yoksa `Error`.
  - `resolveVoiceForSpeaker(script: VoiceoverScript, speaker: string): { cast: CastMember; voice: ResolvedVoice }` — cast'te yoksa `Error`.
  - `validateSpeakers(script: VoiceoverScript): void` — cast'te olmayan speaker'a sahip segment varsa `Error`.

- [ ] **Step 1: Başarısız test yaz**

`tests/core/voices.test.ts`:
```ts
import { expect, test } from 'vitest';
import { parseVoiceId, resolveVoiceForSpeaker, validateSpeakers } from '../../src/core/voices.js';
import type { VoiceoverScript } from '../../src/core/types.js';

const script: VoiceoverScript = {
  schemaVersion: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [{ characterId: 'narrator', displayName: 'Anlatıcı', voiceId: 'gemini:Charon', baseStyle: 'sakin' }],
  segments: [{ id: 's1', speaker: 'narrator', type: 'narration', text: 'x' }],
};

test('voiceId çözer', () => {
  expect(parseVoiceId('gemini:Charon')).toEqual({ provider: 'gemini', providerVoice: 'Charon' });
});
test('iki nokta yoksa hata', () => { expect(() => parseVoiceId('Charon')).toThrow(); });
test('konuşmacının sesini bulur', () => {
  const r = resolveVoiceForSpeaker(script, 'narrator');
  expect(r.voice.providerVoice).toBe('Charon');
  expect(r.cast.baseStyle).toBe('sakin');
});
test('bilinmeyen konuşmacı reddedilir', () => {
  const bad = { ...script, segments: [{ id: 's1', speaker: 'ghost', type: 'narration' as const, text: 'x' }] };
  expect(() => validateSpeakers(bad)).toThrow(/ghost/);
});
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/voices.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/voices.ts` yaz**

```ts
import type { CastMember, ResolvedVoice, VoiceoverScript } from './types.js';

export function parseVoiceId(voiceId: string): ResolvedVoice {
  const idx = voiceId.indexOf(':');
  if (idx <= 0 || idx === voiceId.length - 1) throw new Error(`Geçersiz voice_id: "${voiceId}" (beklenen "provider:voice")`);
  return { provider: voiceId.slice(0, idx), providerVoice: voiceId.slice(idx + 1) };
}

export function resolveVoiceForSpeaker(script: VoiceoverScript, speaker: string): { cast: CastMember; voice: ResolvedVoice } {
  const cast = script.cast.find((c) => c.characterId === speaker);
  if (!cast) throw new Error(`Konuşmacı cast'te yok: "${speaker}"`);
  return { cast, voice: parseVoiceId(cast.voiceId) };
}

export function validateSpeakers(script: VoiceoverScript): void {
  const known = new Set(script.cast.map((c) => c.characterId));
  for (const seg of script.segments) {
    if (!known.has(seg.speaker)) throw new Error(`Segment ${seg.id}: bilinmeyen konuşmacı "${seg.speaker}"`);
  }
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/voices.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/voices.ts tests/core/voices.test.ts
git commit -m "feat(core): ses çözümleme ve konuşmacı doğrulama"
```

---

### Task 4: Maliyet hesabı

**Files:**
- Create: `src/core/cost.ts`
- Test: `tests/core/cost.test.ts`

**Interfaces:**
- Consumes: `TtsCost` (types.ts)
- Produces:
  - `computeGeminiCost(textTokens: number, audioTokens: number): TtsCost` — `unit:'audio_tokens'`, `amount: audioTokens`, `usd` = textTokens/1e6*0.5 + audioTokens/1e6*10.
  - `audioTokensToMs(audioTokens: number): number` — `audioTokens / 25 * 1000`.
  - `formatUsd(usd: number): string` — `"$0.0123"` (4 ondalık).

- [ ] **Step 1: Başarısız test yaz**

`tests/core/cost.test.ts`:
```ts
import { expect, test } from 'vitest';
import { audioTokensToMs, computeGeminiCost, formatUsd } from '../../src/core/cost.js';

test('gemini maliyeti hesaplar', () => {
  const c = computeGeminiCost(1000, 25000); // 25000 audio token
  expect(c.unit).toBe('audio_tokens');
  expect(c.amount).toBe(25000);
  // 1000/1e6*0.5 + 25000/1e6*10 = 0.0005 + 0.25 = 0.2505
  expect(c.usd).toBeCloseTo(0.2505, 6);
});
test('audio token -> ms', () => { expect(audioTokensToMs(25)).toBe(1000); });
test('usd formatı', () => { expect(formatUsd(0.2505)).toBe('$0.2505'); });
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/cost.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/cost.ts` yaz**

```ts
import type { TtsCost } from './types.js';

const TEXT_USD_PER_TOKEN = 0.5 / 1_000_000;
const AUDIO_USD_PER_TOKEN = 10 / 1_000_000;
const AUDIO_TOKENS_PER_SECOND = 25;

export function computeGeminiCost(textTokens: number, audioTokens: number): TtsCost {
  const usd = textTokens * TEXT_USD_PER_TOKEN + audioTokens * AUDIO_USD_PER_TOKEN;
  return { unit: 'audio_tokens', amount: audioTokens, usd };
}
export function audioTokensToMs(audioTokens: number): number {
  return (audioTokens / AUDIO_TOKENS_PER_SECOND) * 1000;
}
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/cost.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/cost.ts tests/core/cost.test.ts
git commit -m "feat(core): gemini maliyet ve süre hesabı"
```

---

### Task 5: WAV/PCM yardımcıları

**Files:**
- Create: `src/core/audio/wav.ts`
- Test: `tests/core/wav.test.ts`

**Interfaces:**
- Consumes: (yok)
- Produces:
  - `pcmToWav(pcm: Buffer, sampleRate?: number, channels?: number, bitsPerSample?: number): Buffer` — varsayılan 24000/1/16. 44-byte RIFF başlığı + PCM.
  - `wavToPcm(wav: Buffer): Buffer` — 44-byte başlığı atar, PCM döner.
  - `makeSilencePcm(ms: number, sampleRate?: number, channels?: number, bitsPerSample?: number): Buffer` — sıfır dolu PCM.

- [ ] **Step 1: Başarısız test yaz**

`tests/core/wav.test.ts`:
```ts
import { expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav, wavToPcm } from '../../src/core/audio/wav.js';

test('pcm -> wav -> pcm round trip', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const wav = pcmToWav(pcm);
  expect(wav.length).toBe(44 + pcm.length);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wavToPcm(wav).equals(pcm)).toBe(true);
});

test('1sn sessizlik = 24000*2 byte', () => {
  const s = makeSilencePcm(1000);
  expect(s.length).toBe(24000 * 2); // 24000 örnek * 16-bit(2 byte) * mono
  expect(s.every((b) => b === 0)).toBe(true);
});
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/wav.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/audio/wav.ts` yaz**

```ts
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function wavToPcm(wav: Buffer): Buffer {
  return wav.subarray(44);
}

export function makeSilencePcm(ms: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const bytes = Math.round((sampleRate * channels * (bitsPerSample / 8) * ms) / 1000);
  return Buffer.alloc(bytes, 0);
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/wav.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/audio/wav.ts tests/core/wav.test.ts
git commit -m "feat(core): WAV/PCM yardımcıları ve sessizlik üretimi"
```

---

### Task 6: MockAdapter (gerçek API'siz TTS)

**Files:**
- Create: `src/core/tts/mock.ts`
- Test: `tests/core/mock.test.ts`

**Interfaces:**
- Consumes: `TtsAdapter`, `TtsSegmentRequest`, `TtsResult` (types.ts); `pcmToWav`, `makeSilencePcm` (audio/wav.ts); `computeGeminiCost` (cost.ts).
- Produces: `class MockAdapter implements TtsAdapter` — `id='mock'`; `synthesize()` metin uzunluğuyla orantılı (her karakter = 50ms) sessiz WAV döner; `durationMs` buna eşit; `cost` deterministik (`audioTokens = round(durationMs/1000*25)`).

- [ ] **Step 1: Başarısız test yaz**

`tests/core/mock.test.ts`:
```ts
import { expect, test } from 'vitest';
import { MockAdapter } from '../../src/core/tts/mock.js';
import { wavToPcm } from '../../src/core/audio/wav.js';

test('mock adapter metinle orantılı WAV üretir', async () => {
  const a = new MockAdapter();
  const r = await a.synthesize({ text: 'abcdefghij', voice: { provider: 'mock', providerVoice: 'x' }, language: 'tr-TR' });
  expect(a.id).toBe('mock');
  expect(r.format).toBe('wav');
  expect(r.durationMs).toBe(10 * 50); // 10 karakter * 50ms
  // 500ms @ 24000Hz*2byte = 24000 byte PCM
  expect(wavToPcm(r.audio).length).toBe(Math.round(24000 * 2 * 0.5));
  expect(r.cost.usd).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/mock.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/tts/mock.ts` yaz**

```ts
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '../types.js';
import { makeSilencePcm, pcmToWav } from '../audio/wav.js';
import { computeGeminiCost } from '../cost.js';

const MS_PER_CHAR = 50;

export class MockAdapter implements TtsAdapter {
  readonly id = 'mock';
  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const durationMs = req.text.length * MS_PER_CHAR;
    const pcm = makeSilencePcm(durationMs);
    const audioTokens = Math.round((durationMs / 1000) * 25);
    return { audio: pcmToWav(pcm), format: 'wav', durationMs, cost: computeGeminiCost(0, audioTokens) };
  }
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/mock.test.ts`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/tts/mock.ts tests/core/mock.test.ts
git commit -m "feat(core): test için MockAdapter"
```

---

### Task 7: Birleştirme (concat + sessizlik → WAV → mp3)

**Files:**
- Create: `src/core/audio/stitch.ts`
- Test: `tests/core/stitch.test.ts`

**Interfaces:**
- Consumes: `pcmToWav`, `wavToPcm`, `makeSilencePcm` (audio/wav.ts); `ffmpeg-static`; Node `child_process`, `fs`, `os`.
- Produces:
  - `concatSegmentsToWav(parts: { wav: Buffer; pauseAfterMs?: number }[]): Buffer` — her parçanın PCM'ini, ardından `pauseAfterMs` sessizliğini birleştirir, tek WAV döner.
  - `wavToMp3(wav: Buffer): Promise<Buffer>` — ffmpeg ile mp3'e kodlar (libmp3lame).

- [ ] **Step 1: Başarısız test yaz**

`tests/core/stitch.test.ts`:
```ts
import { expect, test } from 'vitest';
import { concatSegmentsToWav, wavToMp3 } from '../../src/core/audio/stitch.js';
import { makeSilencePcm, pcmToWav, wavToPcm } from '../../src/core/audio/wav.js';

test('segmentleri sessizlikle birleştirir', () => {
  const a = pcmToWav(makeSilencePcm(500)); // 0.5sn
  const b = pcmToWav(makeSilencePcm(500));
  const out = concatSegmentsToWav([{ wav: a, pauseAfterMs: 1000 }, { wav: b }]);
  // 0.5 + 1.0 (pause) + 0.5 = 2.0 sn PCM = 24000*2*2 byte
  expect(wavToPcm(out).length).toBe(24000 * 2 * 2);
});

test('wav -> mp3 kodlar', async () => {
  const wav = pcmToWav(makeSilencePcm(300));
  const mp3 = await wavToMp3(wav);
  expect(mp3.length).toBeGreaterThan(0);
  // mp3 çerçevesi 0xFF ile başlar (ID3 yoksa) — en azından boş değil ve wav değil
  expect(mp3.toString('ascii', 0, 4)).not.toBe('RIFF');
}, 20000);
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/stitch.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/audio/stitch.ts` yaz**

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { makeSilencePcm, pcmToWav, wavToPcm } from './wav.js';

const execFileAsync = promisify(execFile);

export function concatSegmentsToWav(parts: { wav: Buffer; pauseAfterMs?: number }[]): Buffer {
  const pcms: Buffer[] = [];
  for (const p of parts) {
    pcms.push(wavToPcm(p.wav));
    if (p.pauseAfterMs && p.pauseAfterMs > 0) pcms.push(makeSilencePcm(p.pauseAfterMs));
  }
  return pcmToWav(Buffer.concat(pcms));
}

export async function wavToMp3(wav: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static bulunamadı');
  const dir = await mkdtemp(join(tmpdir(), 'wntts-'));
  const inPath = join(dir, 'in.wav');
  const outPath = join(dir, 'out.mp3');
  try {
    await writeFile(inPath, wav);
    await execFileAsync(ffmpegPath, ['-y', '-i', inPath, '-c:a', 'libmp3lame', '-b:a', '128k', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/stitch.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/audio/stitch.ts tests/core/stitch.test.ts
git commit -m "feat(core): PCM birleştirme + ffmpeg mp3 kodlama"
```

---

### Task 8: Orkestratör (script → episode.mp3)

**Files:**
- Create: `src/core/orchestrator.ts`
- Test: `tests/core/orchestrator.test.ts`

**Interfaces:**
- Consumes: `VoiceoverScript`, `TtsAdapter`, `TtsSegmentRequest` (types.ts); `validateSpeakers`, `resolveVoiceForSpeaker` (voices.ts); `concatSegmentsToWav`, `wavToMp3` (audio/stitch.ts); `formatUsd` (cost.ts).
- Produces:
  - `interface SegmentResult { id: string; speaker: string; durationMs: number; usd: number; }`
  - `interface EpisodeResult { mp3: Buffer; segments: SegmentResult[]; totalUsd: number; totalDurationMs: number; }`
  - `generateEpisode(script: VoiceoverScript, adapter: TtsAdapter, onProgress?: (done: number, total: number) => void): Promise<EpisodeResult>`

- [ ] **Step 1: Başarısız test yaz**

`tests/core/orchestrator.test.ts`:
```ts
import { expect, test } from 'vitest';
import { generateEpisode } from '../../src/core/orchestrator.js';
import { MockAdapter } from '../../src/core/tts/mock.js';
import type { VoiceoverScript } from '../../src/core/types.js';

const script: VoiceoverScript = {
  schemaVersion: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [
    { characterId: 'narrator', displayName: 'Anlatıcı', voiceId: 'mock:A' },
    { characterId: 'kaan', displayName: 'Kaan', voiceId: 'mock:B' },
  ],
  segments: [
    { id: 's1', speaker: 'narrator', type: 'narration', text: 'Kapı açıldı.', pauseAfterMs: 200 },
    { id: 's2', speaker: 'kaan', type: 'dialogue', text: 'Kim var?' },
  ],
};

test('mock adapter ile bölüm üretir', async () => {
  let progress = 0;
  const r = await generateEpisode(script, new MockAdapter(), (d) => { progress = d; });
  expect(r.segments).toHaveLength(2);
  expect(r.mp3.length).toBeGreaterThan(0);
  expect(r.totalUsd).toBeGreaterThan(0);
  expect(r.totalDurationMs).toBeGreaterThan(0);
  expect(progress).toBe(2);
}, 20000);

test('bilinmeyen konuşmacıda hata verir', async () => {
  const bad = { ...script, segments: [{ id: 's1', speaker: 'ghost', type: 'narration' as const, text: 'x' }] };
  await expect(generateEpisode(bad, new MockAdapter())).rejects.toThrow(/ghost/);
});
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/orchestrator.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/orchestrator.ts` yaz**

```ts
import type { TtsAdapter, VoiceoverScript } from './types.js';
import { resolveVoiceForSpeaker, validateSpeakers } from './voices.js';
import { concatSegmentsToWav, wavToMp3 } from './audio/stitch.js';

export interface SegmentResult { id: string; speaker: string; durationMs: number; usd: number; }
export interface EpisodeResult { mp3: Buffer; segments: SegmentResult[]; totalUsd: number; totalDurationMs: number; }

export async function generateEpisode(
  script: VoiceoverScript,
  adapter: TtsAdapter,
  onProgress?: (done: number, total: number) => void,
): Promise<EpisodeResult> {
  validateSpeakers(script);
  const parts: { wav: Buffer; pauseAfterMs?: number }[] = [];
  const segments: SegmentResult[] = [];
  let totalUsd = 0, totalDurationMs = 0;

  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const { cast, voice } = resolveVoiceForSpeaker(script, seg.speaker);
    const style = [cast.baseStyle, seg.style].filter(Boolean).join(', ') || undefined;
    const res = await adapter.synthesize({
      text: seg.text, voice, language: script.language,
      style, tags: seg.tags, pronunciations: script.pronunciations,
    });
    parts.push({ wav: res.audio, pauseAfterMs: seg.pauseAfterMs });
    const usd = res.cost.usd ?? 0;
    segments.push({ id: seg.id, speaker: seg.speaker, durationMs: res.durationMs, usd });
    totalUsd += usd; totalDurationMs += res.durationMs;
    onProgress?.(i + 1, script.segments.length);
  }

  const wav = concatSegmentsToWav(parts);
  const mp3 = await wavToMp3(wav);
  return { mp3, segments, totalUsd, totalDurationMs };
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/orchestrator.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts tests/core/orchestrator.test.ts
git commit -m "feat(core): script -> episode orkestratörü"
```

---

### Task 9: GeminiAdapter (gerçek TTS)

**Files:**
- Create: `src/core/tts/gemini.ts`
- Test: `tests/core/gemini.test.ts`

**Interfaces:**
- Consumes: `TtsAdapter`, `TtsSegmentRequest`, `TtsResult` (types.ts); `pcmToWav` (audio/wav.ts); `computeGeminiCost`, `audioTokensToMs` (cost.ts); `@google/genai`.
- Produces:
  - `buildPrompt(req: TtsSegmentRequest): string` — stil/tag/telaffuzu İngilizce yönergeyle metnin önüne ekler (Türkçe metin korunur). Saf fonksiyon → test edilebilir.
  - `class GeminiAdapter implements TtsAdapter` — `id='gemini-2.5-flash-tts'`; ctor `(apiKey: string, model?: string)`; `synthesize()` Gemini'yi çağırır, base64 PCM'i WAV'a sarar, `usageMetadata`'dan maliyeti hesaplar.

- [ ] **Step 1: `buildPrompt` için başarısız test yaz** (gerçek API çağırmadan saf fonksiyonu test ederiz)

`tests/core/gemini.test.ts`:
```ts
import { expect, test } from 'vitest';
import { buildPrompt } from '../../src/core/tts/gemini.js';

test('stil ve telaffuzu prompt önüne ekler, Türkçe metni korur', () => {
  const p = buildPrompt({
    text: 'Kim var orada?', voice: { provider: 'gemini', providerVoice: 'Puck' }, language: 'tr-TR',
    style: 'korkmuş ama meydan okuyan', tags: ['[scared]'],
    pronunciations: [{ term: 'Aztharion', sayAs: 'Az-ta-ri-on' }],
  });
  expect(p).toContain('Kim var orada?');       // Türkçe metin aynen
  expect(p).toContain('korkmuş ama meydan okuyan');
  expect(p).toContain('[scared]');
  expect(p).toContain('Aztharion');            // telaffuz ipucu
});

test('stil yoksa sadece metni döner', () => {
  const p = buildPrompt({ text: 'Merhaba.', voice: { provider: 'gemini', providerVoice: 'Charon' }, language: 'tr-TR' });
  expect(p.trim()).toBe('Merhaba.');
});
```

- [ ] **Step 2: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/core/gemini.test.ts`
Expected: FAIL (modül yok)

- [ ] **Step 3: `src/core/tts/gemini.ts` yaz**

> NOT: `@google/genai` TTS çağrısının alan adlarını mevcut dokümana karşı doğrula (bkz. https://ai.google.dev/gemini-api/docs/speech-generation). Aşağıdaki şekil mid-2026 SDK'ya göredir: `generateContent` + `responseModalities:['AUDIO']` + `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`; ses `candidates[0].content.parts[0].inlineData.data` (base64 PCM, 24kHz/16-bit/mono).

```ts
import { GoogleGenAI } from '@google/genai';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '../types.js';
import { pcmToWav } from '../audio/wav.js';
import { audioTokensToMs, computeGeminiCost } from '../cost.js';

export function buildPrompt(req: TtsSegmentRequest): string {
  const directives: string[] = [];
  if (req.style) directives.push(`Style: ${req.style}`);
  if (req.tags?.length) directives.push(req.tags.join(' '));
  if (req.pronunciations?.length) {
    directives.push('Pronounce: ' + req.pronunciations.map((p) => `${p.term} as ${p.sayAs}`).join('; '));
  }
  if (directives.length === 0) return req.text;
  return `${directives.join('. ')}.\n${req.text}`;
}

export class GeminiAdapter implements TtsAdapter {
  readonly id = 'gemini-2.5-flash-tts';
  private ai: GoogleGenAI;
  constructor(apiKey: string, private model = 'gemini-2.5-flash-preview-tts') {
    this.ai = new GoogleGenAI({ apiKey });
  }
  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const prompt = buildPrompt(req);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice.providerVoice } } },
      },
    });
    const part = response.candidates?.[0]?.content?.parts?.[0];
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error('Gemini yanıtında ses verisi yok');
    const pcm = Buffer.from(b64, 'base64');
    const usage = response.usageMetadata;
    const audioTokens = usage?.candidatesTokenCount ?? Math.round((pcm.length / 2 / 24000) * 25);
    const textTokens = usage?.promptTokenCount ?? 0;
    return {
      audio: pcmToWav(pcm), format: 'wav',
      durationMs: audioTokensToMs(audioTokens),
      cost: computeGeminiCost(textTokens, audioTokens),
    };
  }
}
```

- [ ] **Step 4: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/core/gemini.test.ts`
Expected: PASS (2 passed) — sadece `buildPrompt` test edilir; gerçek API çağrısı Task 10 bake-off'ta manuel.

- [ ] **Step 5: Commit**

```bash
git add src/core/tts/gemini.ts tests/core/gemini.test.ts
git commit -m "feat(core): GeminiAdapter (2.5 flash tts) + prompt kurucu"
```

---

### Task 10: CLI + Türkçe bake-off (manuel doğrulama)

**Files:**
- Create: `src/cli/generate.ts`, `fixtures/sample-tr.json`
- Test: `tests/cli/generate.test.ts`

**Interfaces:**
- Consumes: `parseScript` (schema.ts); `generateEpisode` (orchestrator.ts); `MockAdapter` (tts/mock.ts); `GeminiAdapter` (tts/gemini.ts); `formatUsd` (cost.ts); Node `fs`.
- Produces: CLI — `tsx src/cli/generate.ts <script.json> [--out <dir>] [--provider gemini|mock]`. `mock` gerçek API çağırmaz; `gemini` `GEMINI_API_KEY` gerektirir. `episode.mp3` yazar + segment/maliyet raporu basar.

- [ ] **Step 1: Türkçe bake-off fixture'ı yaz**

`fixtures/sample-tr.json` (anlatıcı + 2 karakter + farklı duygular + fantastik isim — bake-off'un test edeceği her şey):
```json
{
  "schema_version": "1.0",
  "series": "Gölge Hükümdarı", "season": 1, "episode": 1,
  "title": "Bake-off Testi", "language": "tr-TR",
  "cast": [
    { "character_id": "narrator", "display_name": "Anlatıcı", "voice_id": "gemini:Charon", "base_style": "sakin, ölçülü, üçüncü şahıs anlatım" },
    { "character_id": "kaan", "display_name": "Kaan", "voice_id": "gemini:Puck", "base_style": "genç, kararlı erkek" },
    { "character_id": "elara", "display_name": "Elara", "voice_id": "gemini:Kore", "base_style": "kadın, bilge" }
  ],
  "segments": [
    { "id": "s1", "speaker": "narrator", "type": "narration", "text": "Zindanın kapısı, Aztharion'un adı fısıldanırken gıcırdayarak açıldı.", "style": "gizemli, yavaş", "pause_after_ms": 400 },
    { "id": "s2", "speaker": "kaan", "type": "dialogue", "text": "Kim var orada? Yaklaşma, seni uyarıyorum!", "style": "korkmuş ama meydan okuyan", "tags": ["[scared]"] },
    { "id": "s3", "speaker": "elara", "type": "dialogue", "text": "Sakin ol, çocuk. Sana zarar vermeye gelmedim.", "style": "sakin, güven veren, hafif alaycı", "pause_after_ms": 300 },
    { "id": "s4", "speaker": "kaan", "type": "dialogue", "text": "O zaman neden buradasın?!", "style": "öfkeli, yüksek sesle", "tags": ["[shouting]"] },
    { "id": "s5", "speaker": "narrator", "type": "narration", "text": "Elara gülümsedi ve gölgelerin arasından bir adım öne çıktı." }
  ],
  "pronunciations": [ { "term": "Aztharion", "say_as": "Az-ta-ri-on" } ]
}
```

- [ ] **Step 2: CLI için başarısız test yaz** (mock provider ile — gerçek API yok)

`tests/cli/generate.test.ts`:
```ts
import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execFileAsync = promisify(execFile);

test('CLI mock provider ile episode.mp3 üretir', async () => {
  const out = await mkdtemp(join(tmpdir(), 'cli-'));
  try {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli/generate.ts', 'fixtures/sample-tr.json', '--out', out, '--provider', 'mock'], { shell: true });
    expect(stdout).toContain('Toplam');
    const mp3 = await readFile(join(out, 'episode.mp3'));
    expect(mp3.length).toBeGreaterThan(0);
  } finally { await rm(out, { recursive: true, force: true }); }
}, 30000);
```

- [ ] **Step 3: Testi çalıştır (fail görmeli)**

Run: `npx vitest run tests/cli/generate.test.ts`
Expected: FAIL (CLI modülü yok)

- [ ] **Step 4: `src/cli/generate.ts` yaz**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseScript } from '../core/schema.js';
import { generateEpisode } from '../core/orchestrator.js';
import { MockAdapter } from '../core/tts/mock.js';
import { GeminiAdapter } from '../core/tts/gemini.js';
import { formatUsd } from '../core/cost.js';
import type { TtsAdapter } from '../core/types.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath || scriptPath.startsWith('--')) { console.error('Kullanım: generate <script.json> [--out dir] [--provider gemini|mock]'); process.exit(1); }
  const outDir = arg('--out', '.')!;
  const provider = arg('--provider', 'gemini')!;

  const script = parseScript(JSON.parse(await readFile(scriptPath, 'utf8')));
  let adapter: TtsAdapter;
  if (provider === 'mock') adapter = new MockAdapter();
  else {
    const key = process.env.GEMINI_API_KEY;
    if (!key) { console.error('GEMINI_API_KEY tanımlı değil (.env)'); process.exit(1); }
    adapter = new GeminiAdapter(key);
  }

  console.log(`Üretiliyor: ${script.title} (${script.segments.length} segment) — provider: ${adapter.id}`);
  const r = await generateEpisode(script, adapter, (d, t) => process.stdout.write(`\r  ${d}/${t} segment`));
  process.stdout.write('\n');

  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'episode.mp3');
  await writeFile(outPath, r.mp3);

  for (const s of r.segments) console.log(`  [${s.id}] ${s.speaker.padEnd(10)} ${Math.round(s.durationMs)}ms  ${formatUsd(s.usd)}`);
  console.log(`\n✓ ${outPath}`);
  console.log(`Toplam: ${(r.totalDurationMs / 1000).toFixed(1)}sn ses, maliyet ${formatUsd(r.totalUsd)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Testi çalıştır (geçmeli)**

Run: `npx vitest run tests/cli/generate.test.ts`
Expected: PASS (1 passed)

- [ ] **Step 6: Tüm testleri çalıştır + commit**

Run: `npx vitest run`
Expected: PASS (tüm dosyalar)

```bash
git add src/cli/generate.ts fixtures/sample-tr.json tests/cli/generate.test.ts
git commit -m "feat(cli): generate komutu + Türkçe bake-off fixture"
```

- [ ] **Step 7: 🎧 BAKE-OFF (manuel — Türkçe kaliteyi doğrula)**

Bu, projenin #1 riskini kapatan adım. Otomatik değil — **kulakla** yapılır.

1. `.env` oluştur: `GEMINI_API_KEY=<anahtarın>` (AI Studio / prepay key).
2. Çalıştır:
   ```bash
   npx tsx src/cli/generate.ts fixtures/sample-tr.json --out ./bakeoff --provider gemini
   ```
3. `./bakeoff/episode.mp3` dinle. Değerlendir:
   - **Doğallık:** Türkçe akıcı ve doğal mı, robotik/yabancı aksanlı mı?
   - **Duygu:** korku/öfke/alaycılık farkları duyuluyor mu (s2/s3/s4)?
   - **Çok ses:** üç ses (Charon/Puck/Kore) birbirinden ayırt ediliyor mu?
   - **Telaffuz:** "Aztharion" doğru okundu mu?
   - **Maliyet:** CLI'nin bastığı `Toplam ... maliyet` makul mü? (kredi bakiyesinin düştüğünü Cloud Console'dan doğrula.)
4. Sonuç **iyi** ise → Plan ② (Supabase) başlar, Gemini varsayılan motor.
   Sonuç **kötü** ise → aynı fixture'ı Chirp 3 HD / Azure için yeni bir adapter'la dene (adapter swappable; küçük bir ek task). Karar birlikte verilir.

**Bu adımın çıktısı bir karardır, kod değil.** Kararı ve dinleme notlarını buraya işleyip commit'le:
```bash
# örn. docs/research/bakeoff-notes.md içine kısa notlar
git add docs/research/bakeoff-notes.md && git commit -m "docs: bake-off dinleme notları ve motor kararı"
```

---

## Self-Review (yazan tarafından)

**1. Spec coverage:** Bu plan spec §6 (JSON şema), §7 (adapter arayüzü), §8'in çekirdek üretim/birleştirme mantığı, §11 Milestone 0 ve §13 test yaklaşımını kapsar. Spec'in §5 (Postgres), §9 (panel), §10 (oynatıcı), §8'in job kuyruğu/retry/cache kısımları **bilinçli olarak Plan ②③④⑤'e** bırakıldı (bu plan bulut/DB'siz saf çekirdek). Kapsam boşluğu yok — sonraki planlara devredildi.

**2. Placeholder scan:** "TBD/TODO/sonra doldur" yok. Task 9'daki "dokümana karşı doğrula" notu bir placeholder değil — çalışan gerçek kod + sürüm-hassas alan uyarısı (bake-off zaten bunu ampirik doğruluyor).

**3. Type consistency:** `TtsAdapter.synthesize`, `TtsSegmentRequest`, `TtsResult`, `ResolvedVoice`, `VoiceoverScript` tüm tasklarda types.ts'teki tek tanımdan tüketiliyor. `generateEpisode`, `parseScript`, `resolveVoiceForSpeaker`, `concatSegmentsToWav`, `wavToMp3`, `computeGeminiCost`, `buildPrompt` isimleri tanımlandıkları task ile kullanıldıkları task arasında birebir aynı.
