# Dilim G — Rehberli Kurulum Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yeni kullanıcı tuzaklarını kapatmak: probe yanıtına model/ses listeleri, tek-tık XTTS kurulumu (bağlantı+sağlayıcı+ses eşitleme), LLM model seçici, "Hızlı kurulum" durum kartı, panelden referans wav yükleme.

**Architecture:** `/api/probe` yanıtı zenginleşir (models/voices dizileri). Yeni `lib/services/xtts-voices.ts` dosya-sistemi servisi + `/api/xtts/voices` (GET/POST) ve `/api/xtts/voices/[name]` (DELETE) route'ları. `lib/ui/setup-status.ts` saf durum-türetme fonksiyonu. Ayarlar sayfası: hızlı kurulum kartı, akıllı preset'ler, model seçici, wav yönetim bölümü.

**Tech Stack:** Next.js/TS + vitest; multipart için Next route handler `req.formData()`.

**Spec:** `docs/superpowers/specs/2026-07-23-panel-slice-g-guided-setup-design.md`
**Dal:** `feat/guided-setup` (main'den; açıldı).

---

### Task 1: Probe zenginleştirme (TDD)

**Files:** Modify `app/api/probe/route.ts`; Test `tests/panel/api-probe.test.ts`.

- [ ] **Step 1: Testleri genişlet** — mevcut ilk iki teste ekleme (aynı test gövdelerinin sonuna):

llm testine: `expect(d.models).toEqual(['a', 'b']);`
tts testine: `expect(d.voices).toEqual(['deneme']);`

Yeni test:

```ts
  test('llm: 20 modelden fazlası kırpılır', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}` }));
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ data: many }) }));
    const d = await (await probeRoute.POST(jsonReq({ kind: 'llm', baseUrl: 'http://x/v1' }))).json();
    expect(d.models).toHaveLength(20);
    expect(d.models[0]).toBe('m0');
  });
```

- [ ] **Step 2: FAIL gör**, sonra route'ta başarı dalını genişlet:

```ts
    if (kind === 'llm') {
      const models = (Array.isArray(data?.data) ? data.data : [])
        .map((m) => (m as { id?: unknown }).id).filter((x): x is string => typeof x === 'string').slice(0, 20);
      return NextResponse.json({ ok: true, detail: tServer(req, 'probe.okModels', { count: models.length }), models });
    }
    const voices = (Array.isArray(data?.voices) ? data.voices : []).filter((x): x is string => typeof x === 'string');
    return NextResponse.json({ ok: true, detail: tServer(req, 'probe.okVoices', { count: voices.length }), voices });
```

(Not: `count` artık kırpılmamış ham sayı yerine llm'de kırpılmış liste uzunluğu olur — 20 üstü nadir; kabul. Mevcut `count` assert'leri `data.length` bekliyorsa test güncellenir: ilk test 2 model — etkilenmez.)

- [ ] **Step 3:** `npx vitest run tests/panel/api-probe.test.ts` PASS + `npx tsc --noEmit`.
- [ ] **Step 4: Commit:** `feat(api): probe yanıtına model/ses listeleri`

---

### Task 2: `xtts-voices` servisi + route'lar (TDD)

**Files:**
- Create: `lib/services/xtts-voices.ts`
- Create: `app/api/xtts/voices/route.ts`, `app/api/xtts/voices/[name]/route.ts`
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`
- Test: `tests/panel/xtts-voices.test.ts`

- [ ] **Step 1: i18n:** tr: `'xttsVoices.onlyWav': 'yalnızca .wav dosyası yüklenebilir'`, `'xttsVoices.invalidName': 'geçersiz dosya adı'`, `'xttsVoices.tooBig': 'dosya çok büyük (üst sınır 20MB)'`, `'xttsVoices.notWav': 'geçerli bir WAV değil (RIFF başlığı yok)'`, `'xttsVoices.notFound': 'dosya yok'` · en: `'xttsVoices.onlyWav': 'only .wav files can be uploaded'`, `'xttsVoices.invalidName': 'invalid file name'`, `'xttsVoices.tooBig': 'file too large (20MB limit)'`, `'xttsVoices.notWav': 'not a valid WAV (missing RIFF header)'`, `'xttsVoices.notFound': 'file not found'`

- [ ] **Step 2: Servis testleri** (geçici dizinle):

```ts
// tests/panel/xtts-voices.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteVoiceFile, listVoiceFiles, sanitizeVoiceName, saveVoiceFile } from '@/lib/services/xtts-voices';

const RIFF = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]);
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtts-voices-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('sanitizeVoiceName', () => {
  test('türkçe/boşluk/uzantı temizlenir', () => {
    expect(sanitizeVoiceName('Kaan Ağabey.WAV')).toBe('kaan-a-abey');
  });
  test('path traversal etkisiz', () => {
    expect(sanitizeVoiceName('../../etc/passwd')).toBe('etc-passwd');
  });
  test('tümü geçersizse hata', () => {
    expect(() => sanitizeVoiceName('....')).toThrow();
  });
});

describe('save/list/delete', () => {
  test('kaydet → listede; sil → listeden düşer', () => {
    const name = saveVoiceFile('Deneme Sesi.wav', RIFF, dir);
    expect(name).toBe('deneme-sesi');
    expect(listVoiceFiles(dir)).toEqual(['deneme-sesi']);
    deleteVoiceFile('deneme-sesi', dir);
    expect(listVoiceFiles(dir)).toEqual([]);
  });
  test('RIFF başlığı yoksa red', () => {
    expect(() => saveVoiceFile('a.wav', Buffer.from('not a wav'), dir)).toThrow(/WAV/);
  });
  test('20MB üstü red', () => {
    const big = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(21 * 1024 * 1024)]);
    expect(() => saveVoiceFile('a.wav', big, dir)).toThrow(/büyük/);
  });
  test('olmayan dosya silinince hata; dizin dışına çıkamaz', () => {
    expect(() => deleteVoiceFile('yok', dir)).toThrow();
    expect(() => deleteVoiceFile('../server', dir)).toThrow();
  });
  test('liste: yalnız .wav, uzantısız adlar, sıralı; olmayan dizin boş liste', () => {
    saveVoiceFile('b.wav', RIFF, dir); saveVoiceFile('a.wav', RIFF, dir);
    fs.writeFileSync(path.join(dir, 'not-voice.txt'), 'x');
    expect(listVoiceFiles(dir)).toEqual(['a', 'b']);
    expect(listVoiceFiles(path.join(dir, 'yok'))).toEqual([]);
  });
});
```

- [ ] **Step 3: FAIL gör**, servisi yaz:

```ts
// lib/services/xtts-voices.ts
import fs from 'node:fs';
import path from 'node:path';

// XTTS referans sesleri: dosya adı = ses adı sözleşmesi (tools/xtts-server/README).
export const XTTS_VOICES_DIR = path.join(process.cwd(), 'tools', 'xtts-server', 'voices');
const MAX_BYTES = 20 * 1024 * 1024;

export function sanitizeVoiceName(raw: string): string {
  const base = raw.toLowerCase().replace(/\.wav$/i, '')
    .replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) throw new Error('geçersiz dosya adı');
  return base;
}

export function listVoiceFiles(dir = XTTS_VOICES_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort();
}

export function saveVoiceFile(name: string, data: Buffer, dir = XTTS_VOICES_DIR): string {
  if (data.length > MAX_BYTES) throw new Error('dosya çok büyük (üst sınır 20MB)');
  if (data.length < 44 || data.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('geçerli bir WAV değil (RIFF başlığı yok)');
  const safe = sanitizeVoiceName(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${safe}.wav`), data);
  return safe;
}

export function deleteVoiceFile(name: string, dir = XTTS_VOICES_DIR): void {
  const p = path.join(dir, `${sanitizeVoiceName(name)}.wav`);
  if (!fs.existsSync(p)) throw new Error('dosya yok');
  fs.unlinkSync(p);
}
```

(Not: sanitize testi `'Kaan Ağabey.WAV'` → `ğ` düşer, boşluklar `-`: `kaan-a-abey`. `[^a-z0-9-_]+` grubu ardışıkları tek `-` yapar.)

- [ ] **Step 4: Route'lar:**

```ts
// app/api/xtts/voices/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getConnection } from '@/lib/services/connections';
import { listVoices } from '@/lib/services/voices';
import { listVoiceFiles, saveVoiceFile } from '@/lib/services/xtts-voices';
import { langFromRequest, tServer } from '@/lib/i18n/server';

export async function GET() {
  return NextResponse.json({ voices: listVoiceFiles() });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: tServer(req, 'error.invalidBody') }, { status: 400 });
  if (!/\.wav$/i.test(file.name)) return NextResponse.json({ error: tServer(req, 'xttsVoices.onlyWav') }, { status: 400 });
  try {
    const name = saveVoiceFile(file.name, Buffer.from(await file.arrayBuffer()));
    // xtts bağlantısı varsa havuza da ekle (yoksa sessiz geç; kullanıcı preset'le sonra eşitler)
    const db = getDb();
    if (getConnection(db, 'xtts') && !listVoices(db, 'xtts').some((v) => v.voice === name)) {
      const { createVoice } = await import('@/lib/services/voices'); // gerçek ad için voices.ts'e bak; POST /api/voices hangi fonksiyonu kullanıyorsa o
      createVoice(db, { provider: 'xtts', voice: name, gender: '', tone: '' });
    }
    return NextResponse.json({ ok: true, name }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

```ts
// app/api/xtts/voices/[name]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { deleteVoiceFile } from '@/lib/services/xtts-voices';
import { tServer } from '@/lib/i18n/server';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  try {
    deleteVoiceFile(decodeURIComponent(name));
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: tServer(req, 'xttsVoices.notFound') }, { status: 404 });
  }
}
```

ÖNEMLİ: `createVoice` adı temsili — `lib/services/voices.ts`'te POST /api/voices'ın kullandığı gerçek oluşturma fonksiyonunu bul ve onu kullan (dinamik import da gereksiz; normal import yap). Servis hata mesajları Türkçe düz metin (mevcut bazı servislerle tutarlı); route çevirisi yalnız bilinen durumlar için.

- [ ] **Step 5:** Servis testleri PASS + tam paket + tsc.
- [ ] **Step 6: Commit:** `feat(panel): panelden XTTS referans sesi yükleme — servis + API`

---

### Task 3: `setupStatus` yardımcı fonksiyonu (TDD)

**Files:** Create `lib/ui/setup-status.ts`; Test `tests/panel/setup-status.test.ts`.

- [ ] **Step 1: Testler:**

```ts
// tests/panel/setup-status.test.ts
import { describe, expect, test } from 'vitest';
import { setupStatus } from '@/lib/ui/setup-status';

const base = {
  provider: 'gemini', llmProvider: 'gemini', llmBaseUrl: '', llmModel: '',
  piperExe: '', geminiKeySource: null as 'db' | 'env' | null,
  connections: [] as { id: string }[], voices: {} as Record<string, { id: string }[]>,
};

describe('setupStatus', () => {
  test('boş kurulum: hepsi eksik', () => {
    expect(setupStatus(base)).toEqual({ llm: false, tts: false, pool: false });
  });
  test('gemini anahtar varsa llm+tts tamam; havuz boşsa pool eksik', () => {
    const s = setupStatus({ ...base, geminiKeySource: 'db' });
    expect(s).toEqual({ llm: true, tts: true, pool: false });
  });
  test('openai-compat llm: adres+model ister', () => {
    expect(setupStatus({ ...base, llmProvider: 'openai-compat', llmBaseUrl: 'http://x' }).llm).toBe(false);
    expect(setupStatus({ ...base, llmProvider: 'openai-compat', llmBaseUrl: 'http://x', llmModel: 'm' }).llm).toBe(true);
  });
  test('bağlantı sağlayıcısı: bağlantı satırı + havuz sesi', () => {
    const s = setupStatus({ ...base, provider: 'xtts', connections: [{ id: 'xtts' }], voices: { xtts: [{ id: 'v1' }] } });
    expect(s.tts).toBe(true);
    expect(s.pool).toBe(true);
  });
  test('piper: exe + model dosyası (havuz) ister', () => {
    expect(setupStatus({ ...base, provider: 'piper', piperExe: '/x/piper' }).tts).toBe(true);
    expect(setupStatus({ ...base, provider: 'piper' }).tts).toBe(false);
  });
  test('mock her adımı geçer', () => {
    expect(setupStatus({ ...base, provider: 'mock', llmProvider: 'mock' })).toEqual({ llm: true, tts: true, pool: true });
  });
});
```

- [ ] **Step 2: FAIL gör**, sonra:

```ts
// lib/ui/setup-status.ts
// Hızlı kurulum kartının saf durum türetimi — GET /api/settings yanıtından hesaplanır.
export interface SetupInput {
  provider: string; llmProvider: string; llmBaseUrl: string; llmModel: string;
  piperExe: string; geminiKeySource: 'db' | 'env' | null;
  connections: { id: string }[]; voices: Record<string, { id: string }[]>;
}
export interface SetupStatus { llm: boolean; tts: boolean; pool: boolean }

export function setupStatus(d: SetupInput): SetupStatus {
  const llm = d.llmProvider === 'mock'
    || (d.llmProvider === 'gemini' && d.geminiKeySource !== null)
    || (d.llmProvider === 'openai-compat' && !!d.llmBaseUrl && !!d.llmModel);
  const tts = d.provider === 'mock'
    || (d.provider === 'gemini' && d.geminiKeySource !== null)
    || (d.provider === 'piper' && !!d.piperExe)
    || d.connections.some((c) => c.id === d.provider);
  const pool = d.provider === 'mock' || (d.voices[d.provider] ?? []).length > 0;
  return { llm, tts, pool };
}
```

- [ ] **Step 3:** PASS + tsc. **Step 4: Commit:** `feat(ui): setupStatus — hızlı kurulum durum türetimi`

---

### Task 4: Ayarlar UI — hızlı kurulum kartı + akıllı preset + model seçici + wav bölümü

**Files:** Modify `app/settings/page.tsx`, `lib/i18n/tr.ts`, `lib/i18n/en.ts`.

- [ ] **Step 1: i18n** (iki dosyaya):

tr:
```ts
  'settings.quickHeading': 'Hızlı kurulum',
  'settings.quickLlm': '1. Beyin (LLM)',
  'settings.quickLlmHint': 'Metni analiz eden model: kim konuşuyor, hangi duyguyla.',
  'settings.quickTts': '2. Ses (TTS)',
  'settings.quickTtsHint': 'Script’i sese çeviren motor.',
  'settings.quickPool': '3. Ses havuzu',
  'settings.quickPoolHint': 'Aktif sağlayıcıda en az bir ses tanımlı olmalı.',
  'settings.quickGo': 'Git',
  'settings.quickReady': 'Kurulum tamam — üretime hazırsın.',
  'settings.xttsSyncVoices': 'Sesleri eşitle',
  'settings.llmModelPick': 'model seç…',
```
en:
```ts
  'settings.quickHeading': 'Quick setup',
  'settings.quickLlm': '1. Brain (LLM)',
  'settings.quickLlmHint': 'The model that analyses text: who speaks, with which emotion.',
  'settings.quickTts': '2. Voice (TTS)',
  'settings.quickTtsHint': 'The engine that turns the script into audio.',
  'settings.quickPool': '3. Voice pool',
  'settings.quickPoolHint': 'The active provider needs at least one voice.',
  'settings.quickGo': 'Go',
  'settings.quickReady': 'Setup complete — ready to produce.',
  'settings.xttsSyncVoices': 'Sync voices',
  'settings.llmModelPick': 'pick a model…',
```

- [ ] **Step 2: Kart id'leri:** Gemini kartına `id="card-gemini"`, Bağlantılar `id="card-connections"`, Piper `id="card-piper"`, XTTS `id="card-xtts"`, LLM `id="card-llm"`, Aktif sağlayıcı `id="card-tts"`.

- [ ] **Step 3: Hızlı kurulum kartı** (dil kartından hemen sonra):

```tsx
      {(() => {
        const s = setupStatus(data);
        const poolTarget = data.provider === 'gemini' ? 'card-gemini' : data.provider === 'piper' ? 'card-piper' : 'card-connections';
        const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        const Row = ({ ok, label, hint, target }: { ok: boolean; label: string; hint: string; target: string }) => (
          <div className="rowitem">
            <span aria-hidden>{ok ? '✓' : '—'}</span>
            <span>{label}</span>
            <span className="muted">{hint}</span>
            {!ok && <button className="ghost" onClick={() => go(target)}>{t('settings.quickGo')}</button>}
          </div>
        );
        return (
          <div className="card" id="quick-setup">
            <h2><Icon name="doc" /> {t('settings.quickHeading')}</h2>
            <div className="rows">
              <Row ok={s.llm} label={t('settings.quickLlm')} hint={t('settings.quickLlmHint')} target="card-llm" />
              <Row ok={s.tts} label={t('settings.quickTts')} hint={t('settings.quickTtsHint')} target="card-tts" />
              <Row ok={s.pool} label={t('settings.quickPool')} hint={t('settings.quickPoolHint')} target={poolTarget} />
            </div>
            {s.llm && s.tts && s.pool && <p className="muted">{t('settings.quickReady')}</p>}
          </div>
        );
      })()}
```

`import { setupStatus } from '@/lib/ui/setup-status';` eklenir. (Row'u sayfa üstünde ayrı bileşen yapmak da kabul — VoicePool desenine uyarak üst seviyede tanımla; IIFE yerine düz JSX tercih edilirse `const s = setupStatus(data)` render gövdesinde hesaplanır.)

- [ ] **Step 4: Akıllı XTTS preset'i.** Mevcut "XTTS sunucusu ekle" düğmesinin onClick'i `setupXtts()` olur; bağlantı varsa düğme etiketi `settings.xttsSyncVoices` (disabled kaldırılır):

```ts
  async function setupXtts() {
    setErr('');
    let conns = data!.connections;
    if (!conns.some((c) => c.id === 'xtts')) {
      const res = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'xtts', baseUrl: 'http://localhost:8020/v1', model: 'xtts-v2' }) });
      if (!res.ok) { setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.connectionAddError')); return; }
    }
    await put({ provider: 'xtts' }); // aktif sağlayıcıyı da geçir — yeni kullanıcı tuzağı #2
    const pr = await fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'tts', baseUrl: 'http://localhost:8020/v1' }) });
    const d = await pr.json().catch(() => ({ ok: false, detail: '?', voices: [] as string[] }));
    if (d.ok) {
      const fresh: SettingsData = await (await fetch('/api/settings')).json(); // eşitleme öncesi güncel havuz (stale state'e karşı)
      const have = new Set((fresh.voices.xtts ?? []).map((v) => v.voice));
      for (const v of (d.voices ?? []) as string[]) {
        if (!have.has(v)) await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'xtts', voice: v }) });
      }
    }
    setProbeMsg((m) => ({ ...m, xtts: `${d.ok ? '✓' : '✗'} ${d.detail}` }));
    await load();
  }
```

Düğme JSX'i:

```tsx
          <button type="button" className="ghost" onClick={setupXtts}>
            <Icon name="plus" /> {data.connections.some((c) => c.id === 'xtts') ? t('settings.xttsSyncVoices') : t('settings.xttsPresetButton')} {detected.xtts && <span className="badge">{t('settings.detectedBadge')}</span>}
          </button>
          {probeMsg.xtts && <span className="muted">{probeMsg.xtts}</span>}
```

- [ ] **Step 5: LLM model seçici.** State `const [llmModels, setLlmModels] = useState<string[]>([]);`. `probe()` yardımcıya llm modellerini yakalama ekle (yanıtı zaten alıyor): `if (d.models) setLlmModels(d.models);`. Preset/sına satırının altına (yalnız liste doluyken):

```tsx
            {llmModels.length > 0 && (
              <select aria-label={t('settings.llmProviderAria')} value="" onChange={async (e) => { const v = e.target.value; if (v) { setLlmModelInput(v); await put({ llmModel: v }); } }}>
                <option value="">{t('settings.llmModelPick')}</option>
                {llmModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
```

- [ ] **Step 6: XTTS kartına "Referans sesler" bölümü.** State `const [xttsFiles, setXttsFiles] = useState<string[]>([]);` + `refreshXttsFiles` (GET /api/xtts/voices) mount'ta ve işlemlerden sonra. Kartın log `<pre>`'sinden sonra:

```tsx
        <div className="rows">
          {xttsFiles.map((f) => (
            <div key={f} className="rowitem">
              <span className="mono">{f}</span>
              <ConfirmButton onConfirm={async () => { await fetch(`/api/xtts/voices/${encodeURIComponent(f)}`, { method: 'DELETE' }); await refreshXttsFiles(); }} ariaLabel={t('settings.deleteVoice')} />
            </div>
          ))}
          <input type="file" accept=".wav" aria-label={t('settings.xttsUploadAria')} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setErr('');
            const fd = new FormData(); fd.append('file', f);
            const res = await fetch('/api/xtts/voices', { method: 'POST', body: fd });
            if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.saveError'));
            e.target.value = '';
            await refreshXttsFiles(); await load();
          }} />
          <p className="muted">{t('settings.xttsVoicesHint')}</p>
        </div>
```

Ek i18n: tr `'settings.xttsUploadAria': 'Referans ses yükle'`, `'settings.xttsVoicesHint': 'Referans kayıt: 6-30 sn temiz ses; dosya adı = panel/ses adı. Yükleme çalışan sunucuya anında yansır.'` · en `'settings.xttsUploadAria': 'Upload reference voice'`, `'settings.xttsVoicesHint': 'Reference recording: 6-30 s of clean audio; file name = voice name. Uploads apply to a running server instantly.'`

- [ ] **Step 7:** `npx tsc --noEmit && npx vitest run` yeşil (i18n parite dahil).
- [ ] **Step 8: Commit:** `feat(ui): hızlı kurulum kartı, akıllı XTTS preset'i, LLM model seçici, wav yükleme`

---

### Task 5: README (EN+TR) + CLAUDE.md + son doğrulama

- [ ] **Step 1:** README'lerde lokal kurulum bölümü: 2. adıma "referans sesleri panelden yükleyebilirsin (Ayarlar → XTTS sunucusu → Referans sesler)" cümlesi; 3. adımın önüne "Ayarlar'ın tepesindeki *Hızlı kurulum* kartı üç adımın durumunu gösterir" cümlesi (EN+TR birebir).
- [ ] **Step 2:** CLAUDE.md Durum: Dilim G satırı + spec yolu; backlog'dan "panelden ses klonlama yönetimi" maddesini çıkar (yapıldı).
- [ ] **Step 3:** `npm test` + `npx tsc --noEmit`.
- [ ] **Step 4: Commit:** `docs: dilim G — README rehberli kurulum + CLAUDE.md`
