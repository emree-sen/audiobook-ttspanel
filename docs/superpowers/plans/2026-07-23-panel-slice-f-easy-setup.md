# Dilim F — Kolay Kurulum Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lokal model kurulum zahmetini kaldırmak: ayarlarda preset/sına/algılama, XTTS için tek komut (`run.sh`), panelden sidecar başlat/durdur.

**Architecture:** Yeni `POST /api/probe` sunucu-tarafı bağlantı sınaması yapar (CORS'suz). `tools/xtts-server/run.sh` venv+pip+başlatmayı tek komuta indirir; `server.py`'ye `GET /health` eklenir. `lib/services/xtts-sidecar.ts` modül-tekil süreç yöneticisi; `app/api/xtts` route'u ve ayarlar kartı onu kullanır.

**Tech Stack:** Next.js/TS + vitest (fetch ve node:child_process mock'ları), bash, Python/FastAPI.

**Spec:** `docs/superpowers/specs/2026-07-23-panel-slice-f-easy-setup-design.md`
**Dal:** `feat/easy-setup` (main'den; açıldı).

---

### Task 1: `/health` + `run.sh` (B)

**Files:**
- Modify: `tools/xtts-server/server.py`
- Create: `tools/xtts-server/run.sh` (chmod +x)
- Modify: `tools/xtts-server/README.md`

- [ ] **Step 1: `server.py`'ye health endpoint'i ekle** (speech handler'ının üstüne):

```python
@app.get("/health")
def health() -> dict:
    # Sına/durum ucu: panel bağlantı testi ve sidecar kartı bunu okur.
    device = DEVICE or ("cuda" if torch.cuda.is_available() else "cpu")
    return {"status": "ok", "voices": sorted(p.stem for p in VOICES_DIR.glob("*.wav")), "device": device}
```

- [ ] **Step 2: `run.sh` oluştur:**

```bash
#!/usr/bin/env bash
# Tek komut kurulum + başlatma: ilk çalıştırmada venv + bağımlılıklar, sonra sunucu.
# Kullanım: ./run.sh [--lang tr] [--port 8020] [--device cpu]
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for c in python3.11 python3.12 python3.13 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    v=$("$c" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])')
    if [ "$v" -ge 310 ]; then PY="$c"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "HATA: Python 3.10+ bulunamadı. macOS: brew install python@3.11" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "[run.sh] ilk kurulum: sanal ortam + bağımlılıklar (birkaç dakika sürebilir)…"
  "$PY" -m venv .venv
  ./.venv/bin/pip install --upgrade pip -q
  ./.venv/bin/pip install -r requirements.txt
fi

if ! ls voices/*.wav >/dev/null 2>&1; then
  echo "[run.sh] UYARI: voices/ boş — voices/<ad>.wav referans kaydı ekleyin (6-30 sn)."
fi

exec ./.venv/bin/python server.py "$@"
```

`chmod +x tools/xtts-server/run.sh`

- [ ] **Step 3: README'yi güncelle** — Setup+Run bölümlerini tek komuta indir:

```markdown
## Setup & Run

```bash
cd tools/xtts-server
./run.sh --lang tr
```

First run creates a virtualenv, installs dependencies and downloads the
XTTS-v2 weights from Hugging Face (~2 GB; CPML license auto-accepted via
`COQUI_TOS_AGREED=1`). Later runs start immediately.
Flags are passed through: `--port 8020`, `--device cpu|cuda|mps`
(`XTTS_DEVICE` env also works; default avoids MPS — it produces broken audio
with this coqui-tts range). `GET /health` reports status, voices and device.
```

(Voices ve Connect the panel bölümleri aynen kalır; eski venv/pip adımları silinir.)

- [ ] **Step 4: Doğrula:** `bash -n tools/xtts-server/run.sh` (sözdizimi) + `python3 -m py_compile tools/xtts-server/server.py` + `test -x tools/xtts-server/run.sh && echo EXEC_OK`.

- [ ] **Step 5: Commit:** `git add tools/xtts-server && git commit -m "feat(tts): xtts-server — /health ucu + tek komut run.sh"`

---

### Task 2: `POST /api/probe` (A-arka uç, TDD)

**Files:**
- Create: `app/api/probe/route.ts`
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`
- Test: `tests/panel/api-probe.test.ts`

- [ ] **Step 1: i18n anahtarları** (iki dosyaya, `error.*` bloğu civarına):

tr: `'probe.okModels': 'bağlandı — {count} model'`, `'probe.okVoices': 'bağlandı — {count} ses'`, `'probe.httpError': 'sunucu hata döndürdü (HTTP {status})'`, `'probe.unreachable': 'ulaşılamadı — sunucu çalışıyor mu?'`
en: `'probe.okModels': 'connected — {count} models'`, `'probe.okVoices': 'connected — {count} voices'`, `'probe.httpError': 'server returned an error (HTTP {status})'`, `'probe.unreachable': 'unreachable — is the server running?'`

- [ ] **Step 2: Başarısız testleri yaz:**

```ts
// tests/panel/api-probe.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as probeRoute from '@/app/api/probe/route';

const jsonReq = (body: unknown) =>
  new NextRequest('http://p', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/probe', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('llm: /models ucuna gider, model sayısını döndürür', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a' }, { id: 'b' }] }) }; });
    const d = await (await probeRoute.POST(jsonReq({ kind: 'llm', baseUrl: 'http://localhost:1234/v1/' }))).json();
    expect(urls[0]).toBe('http://localhost:1234/v1/models');
    expect(d.ok).toBe(true);
    expect(d.detail).toContain('2');
  });

  test('tts: /v1 kökünden /health okur, ses sayısını döndürür', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ status: 'ok', voices: ['deneme'], device: 'cpu' }) }; });
    const d = await (await probeRoute.POST(jsonReq({ kind: 'tts', baseUrl: 'http://localhost:8020/v1' }))).json();
    expect(urls[0]).toBe('http://localhost:8020/health');
    expect(d.ok).toBe(true);
    expect(d.detail).toContain('1');
  });

  test('HTTP hatası ok:false + durum kodu', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const d = await (await probeRoute.POST(jsonReq({ kind: 'llm', baseUrl: 'http://x/v1' }))).json();
    expect(d.ok).toBe(false);
    expect(d.detail).toContain('500');
  });

  test('ulaşılamayan sunucu ok:false', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const d = await (await probeRoute.POST(jsonReq({ kind: 'tts', baseUrl: 'http://localhost:9/v1' }))).json();
    expect(d.ok).toBe(false);
  });

  test('geçersiz gövde 400', async () => {
    expect((await probeRoute.POST(jsonReq({ kind: 'x' }))).status).toBe(400);
  });
});
```

- [ ] **Step 3: FAIL gör:** `npx vitest run tests/panel/api-probe.test.ts` (modül yok).

- [ ] **Step 4: Route'u yaz:**

```ts
// app/api/probe/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { tServer } from '@/lib/i18n/server';

const schema = z.object({ kind: z.enum(['llm', 'tts']), baseUrl: z.string().min(1) });

// Sunucu-tarafı bağlantı sınama: tarayıcıdan CORS'a takılmadan lokal sunucuları yoklar.
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: tServer(req, 'error.invalidBody') }, { status: 400 });
  const { kind, baseUrl } = parsed.data;
  const base = baseUrl.replace(/\/+$/, '');
  const url = kind === 'llm' ? `${base}/models` : `${base.replace(/\/v1$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NextResponse.json({ ok: false, detail: tServer(req, 'probe.httpError', { status: res.status }) });
    const data = (await res.json().catch(() => null)) as { data?: unknown[]; voices?: unknown[] } | null;
    const count = kind === 'llm'
      ? (Array.isArray(data?.data) ? data.data.length : 0)
      : (Array.isArray(data?.voices) ? data.voices.length : 0);
    return NextResponse.json({ ok: true, detail: tServer(req, kind === 'llm' ? 'probe.okModels' : 'probe.okVoices', { count }) });
  } catch {
    return NextResponse.json({ ok: false, detail: tServer(req, 'probe.unreachable') });
  }
}
```

- [ ] **Step 5: PASS gör** + `npx vitest run tests/panel/i18n.test.ts` + `npx tsc --noEmit`.

- [ ] **Step 6: Commit:** `git add app/api/probe lib/i18n tests/panel/api-probe.test.ts && git commit -m "feat(api): /api/probe — LLM/TTS bağlantı sınama"`

---

### Task 3: Ayarlar UI — preset + sına + algılama (A-ön uç)

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`

- [ ] **Step 1: i18n anahtarları** (iki dosyaya, `settings.llm*` civarına):

tr: `'settings.probeButton': 'Bağlantıyı sına'`, `'settings.detectedBadge': 'algılandı'`, `'settings.xttsPresetButton': 'XTTS sunucusu ekle'`, `'settings.presetHint': 'Preset düğmeleri adresi doldurur; "algılandı" rozeti sunucunun o portta yanıt verdiğini gösterir.'`
en: `'settings.probeButton': 'Test connection'`, `'settings.detectedBadge': 'detected'`, `'settings.xttsPresetButton': 'Add XTTS server'`, `'settings.presetHint': 'Preset buttons fill the address; the "detected" badge means the server answered on that port.'`

- [ ] **Step 2: State + algılama + yardımcılar** (`SettingsPage` içine):

```ts
  const [probeMsg, setProbeMsg] = useState<Record<string, string>>({}); // anahtar: 'llm' | bağlantı id'si
  const [detected, setDetected] = useState<Record<string, boolean>>({});

  async function probe(kind: 'llm' | 'tts', baseUrl: string, msgKey: string) {
    const res = await fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, baseUrl }) });
    const d = await res.json().catch(() => ({ ok: false, detail: '?' }));
    setProbeMsg((m) => ({ ...m, [msgKey]: `${d.ok ? '✓' : '✗'} ${d.detail}` }));
    return !!d.ok;
  }

  // Sayfa açılışında bilinen portları sessizce yokla (yalnızca rozet için).
  useEffect(() => {
    const targets: [string, 'llm' | 'tts', string][] = [
      ['lmstudio', 'llm', 'http://localhost:1234/v1'],
      ['ollama', 'llm', 'http://localhost:11434/v1'],
      ['xtts', 'tts', 'http://localhost:8020/v1'],
    ];
    for (const [key, kind, baseUrl] of targets) {
      fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, baseUrl }) })
        .then((r) => r.json()).then((d) => setDetected((m) => ({ ...m, [key]: !!d.ok }))).catch(() => {});
    }
  }, []);
```

- [ ] **Step 3: LLM kartına presetler + sına.** `openai-compat` bloğundaki formun ÜSTÜNE:

```tsx
            <div className="row">
              <button type="button" className="ghost" onClick={() => { setLlmBaseInput('http://localhost:1234/v1'); put({ llmProvider: 'openai-compat', llmBaseUrl: 'http://localhost:1234/v1' }); }}>
                LM Studio {detected.lmstudio && <span className="badge">{t('settings.detectedBadge')}</span>}
              </button>
              <button type="button" className="ghost" onClick={() => { setLlmBaseInput('http://localhost:11434/v1'); put({ llmProvider: 'openai-compat', llmBaseUrl: 'http://localhost:11434/v1' }); }}>
                Ollama {detected.ollama && <span className="badge">{t('settings.detectedBadge')}</span>}
              </button>
              <button type="button" className="ghost" onClick={() => probe('llm', llmBaseInput.trim() || 'http://localhost:1234/v1', 'llm')}>{t('settings.probeButton')}</button>
              {probeMsg.llm && <span className="muted">{probeMsg.llm}</span>}
            </div>
```

ve `settings.llmLocalHint` paragrafının altına `<p className="muted">{t('settings.presetHint')}</p>` EKLENMEZ (hint zaten var — kalabalık olmasın; presetHint yalnızca Bağlantılar bölümünde kullanılır).

- [ ] **Step 4: Bağlantılar kartına XTTS preset + sına.** Bağlantı ekleme formunun ÜSTÜNE:

```tsx
        <div className="row">
          <button type="button" className="ghost" disabled={data.connections.some((c) => c.id === 'xtts')}
            onClick={async () => {
              setErr('');
              const res = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'xtts', baseUrl: 'http://localhost:8020/v1', model: 'xtts-v2' }) });
              if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.connectionAddError'));
              await load();
            }}>
            <Icon name="plus" /> {t('settings.xttsPresetButton')} {detected.xtts && <span className="badge">{t('settings.detectedBadge')}</span>}
          </button>
          <span className="muted">{t('settings.presetHint')}</span>
        </div>
```

Her bağlantının `<details>` içine (`addDefaults` düğmesinin yanına):

```tsx
            <button className="ghost" onClick={() => probe('tts', c.baseUrl, c.id)}>{t('settings.probeButton')}</button>
            {probeMsg[c.id] && <span className="muted">{probeMsg[c.id]}</span>}
```

- [ ] **Step 5: Doğrula:** `npx tsc --noEmit && npx vitest run` (tam paket) — yeşil.

- [ ] **Step 6: Commit:** `git add app/settings/page.tsx lib/i18n && git commit -m "feat(ui): ayarlar — LM Studio/Ollama/XTTS preset, bağlantı sınama, algılama rozetleri"`

---

### Task 4: Sidecar servis + `/api/xtts` (C-arka uç, TDD)

**Files:**
- Create: `lib/services/xtts-sidecar.ts`
- Create: `app/api/xtts/route.ts`
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`
- Test: `tests/panel/xtts-sidecar.test.ts`

- [ ] **Step 1: i18n:** tr: `'xtts.alreadyRunning': 'XTTS sunucusu zaten çalışıyor'`, `'xtts.notRunning': 'XTTS sunucusu çalışmıyor'` · en: `'xtts.alreadyRunning': 'XTTS server is already running'`, `'xtts.notRunning': 'XTTS server is not running'`

- [ ] **Step 2: Başarısız testleri yaz:**

```ts
// tests/panel/xtts-sidecar.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

function fakeChild() {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => void; killed: boolean };
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.killed = false; c.kill = vi.fn(() => { c.killed = true; });
  return c;
}

describe('xtts-sidecar', () => {
  beforeEach(() => { vi.resetModules(); spawnMock.mockReset(); });

  test('start: run.sh spawn edilir, loglar halka tamponda birikir', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/repo/tools/xtts-server');
    expect(spawnMock).toHaveBeenCalledWith('bash', ['run.sh'], { cwd: '/repo/tools/xtts-server' });
    c.stdout.emit('data', Buffer.from('satır 1\nsatır 2\n'));
    c.stderr.emit('data', Buffer.from('uyarı\n'));
    const s = mod.xttsStatus();
    expect(s.alive).toBe(true);
    expect(s.log).toEqual(['satır 1', 'satır 2', 'uyarı']);
  });

  test('çifte start reddedilir; exit sonrası tekrar start olur', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    expect(() => mod.xttsStart('/d')).toThrow();
    c.emit('exit', 0);
    expect(mod.xttsStatus().alive).toBe(false);
    spawnMock.mockReturnValue(fakeChild());
    expect(() => mod.xttsStart('/d')).not.toThrow();
  });

  test('sıfır-dışı çıkış kodu error detayına yazılır', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    c.emit('exit', 1);
    const s = mod.xttsStatus();
    expect(s.alive).toBe(false);
    expect(s.exitInfo).toContain('1');
  });

  test('stop: kill çağrılır', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    mod.xttsStop();
    expect(c.kill).toHaveBeenCalled();
  });

  test('log tamponu 50 satırla sınırlı', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    for (let i = 0; i < 60; i++) c.stdout.emit('data', Buffer.from(`satır ${i}\n`));
    const s = mod.xttsStatus();
    expect(s.log).toHaveLength(50);
    expect(s.log[0]).toBe('satır 10');
  });
});
```

- [ ] **Step 3: FAIL gör**, sonra servisi yaz:

```ts
// lib/services/xtts-sidecar.ts
import { spawn, type ChildProcess } from 'node:child_process';

// Modül-tekil sidecar yöneticisi: panel süreciyle yaşar, detach yok (spec C).
const LOG_MAX = 50;
let child: ChildProcess | null = null;
let log: string[] = [];
let exitInfo = '';

function push(chunk: string) {
  for (const l of chunk.split('\n')) {
    const s = l.trimEnd();
    if (!s) continue;
    log.push(s);
    if (log.length > LOG_MAX) log.shift();
  }
}

export function xttsStart(dir: string): void {
  if (child) throw new Error('already running');
  log = []; exitInfo = '';
  child = spawn('bash', ['run.sh'], { cwd: dir });
  child.stdout?.on('data', (d) => push(String(d)));
  child.stderr?.on('data', (d) => push(String(d)));
  child.on('exit', (code) => { exitInfo = code ? `çıkış kodu ${code}` : ''; child = null; });
  child.on('error', (e) => { exitInfo = e.message; child = null; });
}

export function xttsStop(): void { child?.kill('SIGTERM'); }
export function xttsStatus(): { alive: boolean; log: string[]; exitInfo: string } {
  return { alive: child !== null, log: [...log], exitInfo };
}
```

- [ ] **Step 4: Route'u yaz:**

```ts
// app/api/xtts/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import path from 'node:path';
import { xttsStart, xttsStatus, xttsStop } from '@/lib/services/xtts-sidecar';
import { tServer } from '@/lib/i18n/server';

const DIR = path.join(process.cwd(), 'tools', 'xtts-server');

// Durum: süreç yaşıyorsa /health'e sorup starting/running ayrımı yapılır.
export async function GET() {
  const s = xttsStatus();
  let state: 'stopped' | 'starting' | 'running' | 'error' = s.alive ? 'starting' : s.exitInfo ? 'error' : 'stopped';
  let voices: string[] = [];
  if (s.alive) {
    try {
      const res = await fetch('http://localhost:8020/health', { signal: AbortSignal.timeout(1500) });
      if (res.ok) { state = 'running'; voices = ((await res.json()) as { voices?: string[] }).voices ?? []; }
    } catch { /* hâlâ açılıyor */ }
  }
  return NextResponse.json({ state, log: s.log, exitInfo: s.exitInfo, voices });
}

export async function POST(req: NextRequest) {
  if (xttsStatus().alive) return NextResponse.json({ error: tServer(req, 'xtts.alreadyRunning') }, { status: 409 });
  xttsStart(DIR);
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function DELETE(req: NextRequest) {
  if (!xttsStatus().alive) return NextResponse.json({ error: tServer(req, 'xtts.notRunning') }, { status: 409 });
  xttsStop();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: PASS gör:** `npx vitest run tests/panel/xtts-sidecar.test.ts tests/panel/i18n.test.ts` + `npx tsc --noEmit`.

- [ ] **Step 6: Commit:** `git add lib/services/xtts-sidecar.ts app/api/xtts lib/i18n tests/panel/xtts-sidecar.test.ts && git commit -m "feat(panel): XTTS sidecar servisi + /api/xtts"`

---

### Task 5: Ayarlar — XTTS sunucusu kartı (C-ön uç)

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`

- [ ] **Step 1: i18n:**

tr: `'settings.xttsHeading': 'XTTS sunucusu (lokal)'`, `'settings.xttsStart': 'Başlat'`, `'settings.xttsStop': 'Durdur'`, `'settings.xttsState.stopped': 'kapalı'`, `'settings.xttsState.starting': 'başlıyor / kuruluyor…'`, `'settings.xttsState.running': 'çalışıyor — {count} ses'`, `'settings.xttsState.error': 'hata: {detail}'`, `'settings.xttsHint': 'İlk başlatma bağımlılıkları ve ~2GB modeli indirir; ilerleme aşağıdaki log satırlarında görünür. Sunucu yalnızca panel açıkken yaşar.'`
en: `'settings.xttsHeading': 'XTTS server (local)'`, `'settings.xttsStart': 'Start'`, `'settings.xttsStop': 'Stop'`, `'settings.xttsState.stopped': 'stopped'`, `'settings.xttsState.starting': 'starting / installing…'`, `'settings.xttsState.running': 'running — {count} voices'`, `'settings.xttsState.error': 'error: {detail}'`, `'settings.xttsHint': 'First start installs dependencies and downloads the ~2 GB model; progress shows in the log lines below. The server lives only while the panel runs.'`

- [ ] **Step 2: State + yoklama** (`SettingsPage` içine):

```ts
  const [xtts, setXtts] = useState<{ state: string; log: string[]; exitInfo: string; voices: string[] }>({ state: 'stopped', log: [], exitInfo: '', voices: [] });

  const refreshXtts = useCallback(async () => {
    const res = await fetch('/api/xtts');
    if (res.ok) setXtts(await res.json());
  }, []);
  useEffect(() => { refreshXtts(); }, [refreshXtts]);
  useEffect(() => {
    if (xtts.state !== 'starting' && xtts.state !== 'running') return;
    const id = setInterval(refreshXtts, 2000);
    return () => clearInterval(id);
  }, [xtts.state, refreshXtts]);
```

- [ ] **Step 3: Kart** (Piper kartının hemen altına):

```tsx
      <div className="card">
        <h2><Icon name="speaker" /> {t('settings.xttsHeading')}</h2>
        <div className="row">
          {xtts.state === 'stopped' || xtts.state === 'error' ? (
            <button onClick={async () => { await fetch('/api/xtts', { method: 'POST' }); await refreshXtts(); }}>{t('settings.xttsStart')}</button>
          ) : (
            <button className="ghost" onClick={async () => { await fetch('/api/xtts', { method: 'DELETE' }); await refreshXtts(); }}>{t('settings.xttsStop')}</button>
          )}
          <span className="muted">
            {xtts.state === 'stopped' && t('settings.xttsState.stopped')}
            {xtts.state === 'starting' && t('settings.xttsState.starting')}
            {xtts.state === 'running' && t('settings.xttsState.running', { count: xtts.voices.length })}
            {xtts.state === 'error' && t('settings.xttsState.error', { detail: xtts.exitInfo })}
          </span>
        </div>
        {xtts.log.length > 0 && xtts.state !== 'stopped' && (
          <pre className="muted" style={{ maxHeight: '8rem', overflow: 'auto', fontSize: '0.75rem' }}>{xtts.log.slice(-12).join('\n')}</pre>
        )}
        <p className="muted">{t('settings.xttsHint')}</p>
      </div>
```

- [ ] **Step 4: Doğrula:** `npx tsc --noEmit && npx vitest run` — yeşil. (t() parametre desteği: `settings.quotaPerDay` gibi mevcut parametreli anahtarlarla aynı mekanizma.)

- [ ] **Step 5: Commit:** `git add app/settings/page.tsx lib/i18n && git commit -m "feat(ui): ayarlar — XTTS sunucusu başlat/durdur kartı"`

---

### Task 6: README (EN+TR) + CLAUDE.md + son doğrulama

**Files:** `README.md`, `README.tr.md`, `CLAUDE.md`

- [ ] **Step 1: README'lerdeki "Fully local setup / Tamamen lokal kurulum" 2. adımını güncelle** — venv kurulumu yerine:

EN: `see [\`tools/xtts-server/\`](tools/xtts-server/README.md) — \`./run.sh --lang tr\` sets everything up on first run, or press **Start** on the XTTS server card in Settings. Then add the connection with the **Add XTTS server** preset button (or manually: address \`http://localhost:8020/v1\`, any model name) and voices named after your reference WAV files.`
TR: `bkz. [\`tools/xtts-server/\`](tools/xtts-server/README.md) — \`./run.sh --lang tr\` ilk çalıştırmada her şeyi kurar; ya da Ayarlar'daki XTTS sunucusu kartından **Başlat**'a bas. Sonra **XTTS sunucusu ekle** preset düğmesiyle bağlantıyı ekle (veya elle: adres \`http://localhost:8020/v1\`, herhangi bir model adı) ve referans WAV dosya adlarıyla sesleri tanımla.`

(1. adıma da kısa ek: EN `Preset buttons for LM Studio/Ollama fill the address for you; "Test connection" verifies it.` / TR `LM Studio/Ollama preset düğmeleri adresi senin yerine doldurur; "Bağlantıyı sına" doğrular.`)

- [ ] **Step 2: CLAUDE.md** — Durum listesine `- Dilim F (kolay kurulum: preset/sına/run.sh/sidecar): docs/superpowers/specs/2026-07-23-panel-slice-f-easy-setup-design.md` satırı.

- [ ] **Step 3: `npm test` + `npx tsc --noEmit`** — yeşil.

- [ ] **Step 4: Commit:** `git add README.md README.tr.md CLAUDE.md && git commit -m "docs: dilim F — README kolay kurulum + CLAUDE.md durumu"`
