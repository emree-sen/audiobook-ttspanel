# Dilim E — Lokal Model Desteği Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel, LLM annotation'ı OpenAI-uyumlu herhangi bir sunucuyla (LM Studio, Ollama, OpenRouter…) ve TTS'i repo içi ince XTTS-v2 sunucusuyla tamamen lokal çalıştırabilsin.

**Architecture:** LLM tarafına mevcut `LlmAdapter` arayüzünü uygulayan `OpenAiCompatLlmAdapter` eklenir (ayarlar: adres/anahtar/model); TTS tarafına kod eklenmez — `tools/xtts-server/` altındaki ~100 satırlık FastAPI servisi standart `/v1/audio/speech` endpoint'i açar ve panelin mevcut `OpenAiCompatAdapter`'ı bağlanır.

**Tech Stack:** TypeScript/Next.js + vitest (panel), Python/FastAPI + coqui-tts (XTTS sunucusu).

**Spec:** `docs/superpowers/specs/2026-07-23-panel-slice-e-local-models-design.md`

---

### Task 0: Dal kurulumu

**Files:** yok (git)

- [ ] **Step 1: `feat/panel-i18n` üzerinden yeni dal aç** (UI işleri i18n altyapısını kullanacak)

```bash
git checkout feat/panel-i18n && git checkout -b feat/local-models
```

- [ ] **Step 2: Temiz durum doğrula**

Run: `git status --short` — Beklenen: yalnızca `?? tsconfig.tsbuildinfo` (git-ignore edilmemiş yapı artığı; dokunma).

---

### Task 1: `stripLlmWrappers` yardımcı fonksiyonu (TDD)

Lokal reasoning modelleri `<think>…</think>` bloklarını ve ` ```json ` çitlerini content'e sızdırabilir; JSON parse öncesi sıyrılmalı.

**Files:**
- Create: `lib/llm/openai.ts`
- Test: `tests/panel/llm-openai.test.ts`

- [ ] **Step 1: Başarısız testi yaz**

```ts
// tests/panel/llm-openai.test.ts
import { describe, expect, test } from 'vitest';
import { stripLlmWrappers } from '@/lib/llm/openai';

describe('stripLlmWrappers', () => {
  test('düz JSON dokunulmadan döner', () => {
    expect(stripLlmWrappers('{"a":1}')).toBe('{"a":1}');
  });
  test('<think> bloğu sıyrılır', () => {
    expect(stripLlmWrappers('<think>hmm\nuzun düşünce</think>\n{"a":1}')).toBe('{"a":1}');
  });
  test('```json çiti sıyrılır', () => {
    expect(stripLlmWrappers('İşte yanıt:\n```json\n{"a":1}\n```\nBitti.')).toBe('{"a":1}');
  });
  test('think + çit birlikte', () => {
    expect(stripLlmWrappers('<think>x</think>```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts`
Beklenen: FAIL — `lib/llm/openai` modülü yok.

- [ ] **Step 3: Minimal implementasyon**

```ts
// lib/llm/openai.ts
// <think>…</think> (lokal reasoning modelleri sızdırır) ve ```json çitlerini sıyırır.
export function stripLlmWrappers(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  return t.trim();
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts` — Beklenen: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add lib/llm/openai.ts tests/panel/llm-openai.test.ts
git commit -m "feat(llm): stripLlmWrappers — think bloğu ve kod çiti temizliği"
```

---

### Task 2: `OpenAiCompatLlmAdapter` (TDD)

**Files:**
- Modify: `lib/llm/openai.ts`
- Test: `tests/panel/llm-openai.test.ts`

- [ ] **Step 1: Başarısız testleri ekle** (fetch mock'lu; mevcut dosyaya `describe` ekle)

```ts
// tests/panel/llm-openai.test.ts — üste importları genişlet:
import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenAiCompatLlmAdapter, stripLlmWrappers } from '@/lib/llm/openai';

// dosya sonuna:
const ok = (content: string, usage?: object) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage }),
  text: async () => '',
});

describe('OpenAiCompatLlmAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('id ve istek gövdesi: messages + response_format, Authorization yalnızca anahtar varsa', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, init }); return ok('{"segments":[]}', { prompt_tokens: 10, completion_tokens: 5 }); });
    const a = new OpenAiCompatLlmAdapter({ baseUrl: 'http://localhost:1234/v1/', model: 'openai/gpt-oss-20b' });
    expect(a.id).toBe('openai-llm:openai/gpt-oss-20b');
    const r = await a.annotate({ system: 'SYS', user: 'USER' });
    expect(r.json).toEqual({ segments: [] });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(calls[0].url).toBe('http://localhost:1234/v1/chat/completions');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('apiKey verilirse Bearer başlığı gider', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { calls.push(init); return ok('{}'); });
    await new OpenAiCompatLlmAdapter({ baseUrl: 'http://x/v1', apiKey: 'gizli', model: 'm' }).annotate({ system: 's', user: 'u' });
    expect((calls[0].headers as Record<string, string>).Authorization).toBe('Bearer gizli');
  });

  test('response_format 4xx ile reddedilirse alansız yeniden dener', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      n++;
      const body = JSON.parse(String(init.body));
      if (body.response_format) return { ok: false, status: 400, text: async () => 'response_format unsupported', json: async () => ({}) };
      return ok('```json\n{"a":1}\n```');
    });
    const r = await new OpenAiCompatLlmAdapter({ baseUrl: 'http://x/v1', model: 'm' }).annotate({ system: 's', user: 'u' });
    expect(n).toBe(2);
    expect(r.json).toEqual({ a: 1 });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 }); // usage alanı yoksa 0
  });

  test('kalıcı HTTP hatası anlaşılır mesajla fırlar', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'patladı', json: async () => ({}) }));
    await expect(new OpenAiCompatLlmAdapter({ baseUrl: 'http://x/v1', model: 'm' }).annotate({ system: 's', user: 'u' }))
      .rejects.toThrow(/HTTP 500.*patladı/);
  });

  test('boş content hatası', async () => {
    vi.stubGlobal('fetch', async () => ok(''));
    await expect(new OpenAiCompatLlmAdapter({ baseUrl: 'http://x/v1', model: 'm' }).annotate({ system: 's', user: 'u' }))
      .rejects.toThrow(/boş/);
  });
});
```

- [ ] **Step 2: Başarısızlığı gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts`
Beklenen: FAIL — `OpenAiCompatLlmAdapter` export edilmiyor.

- [ ] **Step 3: Adapter'ı yaz** (`lib/llm/openai.ts` dosyasına ekle)

```ts
import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';
import { extractJson } from './schema';

export interface OpenAiCompatLlmConfig { baseUrl: string; apiKey?: string | null; model: string }

// OpenAI-uyumlu /chat/completions (LM Studio, Ollama, OpenRouter, Groq…).
// baseUrl "/v1" dahil girilir. Şema doğrulama + retry annotateChunk'ta; adapter şema bilmez.
export class OpenAiCompatLlmAdapter implements LlmAdapter {
  readonly id: string;
  constructor(private readonly cfg: OpenAiCompatLlmConfig) { this.id = `openai-llm:${cfg.model}`; }

  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    // json_object bazı sunucularda desteklenmez: 4xx dönerse alansız bir deneme daha.
    let res = await this.post(req, true);
    if (!res.ok && res.status >= 400 && res.status < 500) res = await this.post(req, false);
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`LLM sunucusu hata döndürdü (HTTP ${res.status}): ${body || 'gövde yok'}`);
    }
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('LLM yanıtı boş (choices[0].message.content yok)');
    const u = data.usage;
    return {
      json: extractJson(stripLlmWrappers(content)),
      usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 },
    };
  }

  private post(req: LlmAnnotateRequest, jsonMode: boolean): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    return fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  }
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts` — Beklenen: PASS (9 test).

- [ ] **Step 5: Commit**

```bash
git add lib/llm/openai.ts tests/panel/llm-openai.test.ts
git commit -m "feat(llm): OpenAI-uyumlu LLM adapter'ı (LM Studio/Ollama/OpenRouter)"
```

---

### Task 3: Ayarlardan adapter üretimi (`llmAdapterFromSettings`)

**Files:**
- Modify: `lib/services/annotation.ts:21-27`
- Test: `tests/panel/llm-openai.test.ts`

- [ ] **Step 1: Başarısız testleri ekle** (dosya sonuna)

```ts
// tests/panel/llm-openai.test.ts — importlara ekle:
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { setSetting } from '@/lib/services/settings';
import { llmAdapterFromSettings } from '@/lib/services/annotation';
import { beforeEach } from 'vitest';

describe('llmAdapterFromSettings — openai-compat', () => {
  let db: Db;
  beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

  test('adres + model ayarlıysa adapter döner', () => {
    setSetting(db, 'llm_provider', 'openai-compat');
    setSetting(db, 'llm_base_url', 'http://localhost:1234/v1');
    setSetting(db, 'llm_model', 'openai/gpt-oss-20b');
    expect(llmAdapterFromSettings(db).id).toBe('openai-llm:openai/gpt-oss-20b');
  });

  test('adres yoksa anlaşılır hata', () => {
    setSetting(db, 'llm_provider', 'openai-compat');
    setSetting(db, 'llm_model', 'm');
    expect(() => llmAdapterFromSettings(db)).toThrow(/LLM sunucu adresi yok/);
  });

  test('model yoksa anlaşılır hata', () => {
    setSetting(db, 'llm_provider', 'openai-compat');
    setSetting(db, 'llm_base_url', 'http://x/v1');
    expect(() => llmAdapterFromSettings(db)).toThrow(/LLM model adı yok/);
  });
});
```

Not: testler `process.env.LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` boş varsayar; test ortamında tanımlı değiller.

- [ ] **Step 2: Başarısızlığı gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts`
Beklenen: FAIL — `openai-compat` bilinmiyor (Gemini anahtar hatası fırlar).

- [ ] **Step 3: Factory'yi genişlet** — `lib/services/annotation.ts` içinde `llmAdapterFromSettings`:

```ts
import { OpenAiCompatLlmAdapter } from '../llm/openai'; // dosya başına

export function llmAdapterFromSettings(db: Db): LlmAdapter {
  const provider = getSetting(db, 'llm_provider') ?? process.env.LLM_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockLlmAdapter();
  if (provider === 'openai-compat') {
    const baseUrl = getSetting(db, 'llm_base_url') ?? process.env.LLM_BASE_URL;
    if (!baseUrl) throw new Error('LLM sunucu adresi yok — Ayarlar’dan girin veya .env LLM_BASE_URL tanımlayın');
    const model = getSetting(db, 'llm_model') ?? process.env.LLM_MODEL;
    if (!model) throw new Error('LLM model adı yok — Ayarlar’dan girin veya .env LLM_MODEL tanımlayın');
    return new OpenAiCompatLlmAdapter({ baseUrl, apiKey: getSetting(db, 'llm_api_key') ?? process.env.LLM_API_KEY, model });
  }
  const key = geminiApiKey(db);
  if (!key) throw new Error('Gemini API anahtarı yok — Ayarlar’dan girin veya .env GEMINI_API_KEY tanımlayın');
  return new GeminiLlmAdapter(key, getSetting(db, 'llm_model') ?? process.env.LLM_MODEL);
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/panel/llm-openai.test.ts tests/panel/annotation.test.ts` — Beklenen: hepsi PASS (regresyon dahil).

- [ ] **Step 5: Commit**

```bash
git add lib/services/annotation.ts tests/panel/llm-openai.test.ts
git commit -m "feat(llm): llm_provider=openai-compat — ayarlardan lokal LLM seçimi"
```

---

### Task 4: Ayarlar API'si (GET/PUT `/api/settings`)

**Files:**
- Modify: `app/api/settings/route.ts`
- Test: `tests/panel/api-settings.test.ts`

- [ ] **Step 1: Başarısız testleri ekle** (`PUT /api/settings` describe bloğuna)

```ts
  test('openai-compat LLM ayarları yazılır; anahtar maskelenir; null silme çalışır', async () => {
    let res = await settingsRoute.PUT(jsonReq('PUT', {
      llmProvider: 'openai-compat', llmBaseUrl: 'http://localhost:1234/v1', llmApiKey: 'lm-studio-key', llmModel: 'openai/gpt-oss-20b',
    }));
    expect(res.status).toBe(200);
    expect(getSetting(db, 'llm_provider')).toBe('openai-compat');
    expect(getSetting(db, 'llm_base_url')).toBe('http://localhost:1234/v1');
    expect(getSetting(db, 'llm_api_key')).toBe('lm-studio-key');
    const d = await (await settingsRoute.GET()).json();
    expect(d.llmProvider).toBe('openai-compat');
    expect(d.llmBaseUrl).toBe('http://localhost:1234/v1');
    expect(d.llmApiKey).toBe('••••-key');
    res = await settingsRoute.PUT(jsonReq('PUT', { llmApiKey: null, llmBaseUrl: '' }));
    expect(res.status).toBe(200);
    expect(getSetting(db, 'llm_api_key')).toBeUndefined();
    expect(getSetting(db, 'llm_base_url')).toBeUndefined();
  });

  test('maskeli LLM anahtarı reddedilir → 400', async () => {
    const res = await settingsRoute.PUT(jsonReq('PUT', { llmApiKey: '••••-key' }));
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Başarısızlığı gör**

Run: `npx vitest run tests/panel/api-settings.test.ts`
Beklenen: FAIL — `.strict()` şema bilinmeyen alanları reddediyor (400).

- [ ] **Step 3: Route'u genişlet** — `app/api/settings/route.ts`:

GET gövdesine (mevcut alanların yanına):

```ts
    llmBaseUrl: getSetting(db, 'llm_base_url') ?? '',
    llmApiKey: (() => { const k = getSetting(db, 'llm_api_key'); return k ? maskKey(k) : null; })(),
```

`putSchema` değişiklikleri:

```ts
  llmProvider: z.enum(['gemini', 'mock', 'openai-compat']).optional(),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().min(1).refine((v) => !v.includes('•'), 'maskeli değer kaydedilemez').nullable().optional(),
```

PUT gövdesine (`setOrDelete('llm_model', …)` satırının yanına):

```ts
  setOrDelete('llm_base_url', b.llmBaseUrl);
  if (b.llmApiKey === null) deleteSetting(db, 'llm_api_key');
  else if (typeof b.llmApiKey === 'string') setSetting(db, 'llm_api_key', b.llmApiKey);
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npx vitest run tests/panel/api-settings.test.ts` — Beklenen: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/route.ts tests/panel/api-settings.test.ts
git commit -m "feat(api): ayarlar — openai-compat LLM alanları (adres/anahtar)"
```

---

### Task 5: Ayarlar UI + i18n

**Files:**
- Modify: `app/settings/page.tsx` (LLM kartı, ~satır 239-252 civarı)
- Modify: `lib/i18n/tr.ts`, `lib/i18n/en.ts`

- [ ] **Step 1: i18n anahtarlarını iki dosyaya ekle** (`settings.llm*` bloğunun yanına)

`lib/i18n/tr.ts`:

```ts
  'settings.llmOpenaiCompat': 'OpenAI-uyumlu (LM Studio / lokal)',
  'settings.llmBaseUrlPlaceholder': 'http://localhost:1234/v1',
  'settings.llmBaseUrlAria': 'LLM sunucu adresi',
  'settings.llmApiKeyPlaceholder': 'API anahtarı (lokalde boş bırakın)',
  'settings.llmLocalHint': 'LM Studio, Ollama, OpenRouter gibi OpenAI-uyumlu her sunucuyla çalışır; lokal sunucularda anahtar gerekmez.',
```

`lib/i18n/en.ts`:

```ts
  'settings.llmOpenaiCompat': 'OpenAI-compatible (LM Studio / local)',
  'settings.llmBaseUrlPlaceholder': 'http://localhost:1234/v1',
  'settings.llmBaseUrlAria': 'LLM server address',
  'settings.llmApiKeyPlaceholder': 'API key (leave empty for local)',
  'settings.llmLocalHint': 'Works with any OpenAI-compatible server such as LM Studio, Ollama or OpenRouter; local servers need no key.',
```

- [ ] **Step 2: i18n parite testi geçiyor mu bak**

Run: `npx vitest run tests/panel/i18n.test.ts` — Beklenen: PASS.

- [ ] **Step 3: LLM kartını genişlet** — `app/settings/page.tsx`:

State'lere (`llmModelInput` yanına) ekle; `load` içinde doldur:

```ts
  const [llmBaseInput, setLlmBaseInput] = useState('');
  const [llmKeyInput, setLlmKeyInput] = useState('');
  // load() içine: setLlmBaseInput(d.llmBaseUrl);
```

`SettingsData` tipine `llmBaseUrl: string; llmApiKey: string | null;` ekle. LLM kartı JSX'i:

```tsx
      <div className="card">
        <h2><Icon name="doc" /> {t('settings.llmHeading')}</h2>
        <div className="row">
          <select value={data.llmProvider} onChange={(e) => put({ llmProvider: e.target.value })} aria-label={t('settings.llmProviderAria')}>
            <option value="gemini">Gemini</option>
            <option value="openai-compat">{t('settings.llmOpenaiCompat')}</option>
            <option value="mock">{t('settings.mockTest')}</option>
          </select>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ llmModel: llmModelInput.trim() }); }}>
            <input value={llmModelInput} onChange={(e) => setLlmModelInput(e.target.value)} placeholder={t('settings.modelPlaceholder')} />
            <button type="submit">{t('common.save')}</button>
          </form>
        </div>
        {data.llmProvider === 'openai-compat' && (
          <>
            <form className="row" onSubmit={async (e) => {
              e.preventDefault();
              await put({ llmBaseUrl: llmBaseInput.trim(), ...(llmKeyInput.trim() ? { llmApiKey: llmKeyInput.trim() } : {}) });
              setLlmKeyInput('');
            }}>
              <input value={llmBaseInput} onChange={(e) => setLlmBaseInput(e.target.value)} placeholder={t('settings.llmBaseUrlPlaceholder')} aria-label={t('settings.llmBaseUrlAria')} />
              <input value={llmKeyInput} onChange={(e) => setLlmKeyInput(e.target.value)} placeholder={data.llmApiKey ?? t('settings.llmApiKeyPlaceholder')} type="password" />
              <button type="submit">{t('common.save')}</button>
            </form>
            <p className="muted">{t('settings.llmLocalHint')}</p>
          </>
        )}
        {data.llmProvider === 'gemini' && <p className="muted">{t('settings.llmUsesGeminiKey')}</p>}
      </div>
```

- [ ] **Step 4: Derleme + tüm panel testleri**

Run: `npx tsc --noEmit && npx vitest run tests/panel` — Beklenen: hata yok, PASS.

- [ ] **Step 5: Elle duman testi**

Run: `npm run dev` → `http://localhost:3000/settings` → LLM sağlayıcıdan "OpenAI-uyumlu" seç → adres/anahtar alanları görünsün, kaydet çalışsın (TR ve EN dilde).

- [ ] **Step 6: Commit**

```bash
git add app/settings/page.tsx lib/i18n/tr.ts lib/i18n/en.ts
git commit -m "feat(ui): ayarlar — OpenAI-uyumlu LLM sağlayıcı alanları (i18n'li)"
```

---

### Task 6: XTTS sunucusu (`tools/xtts-server/`)

Python tarafı — vitest kapsamı dışında; doğrulama elle (Step 5-6).

**Files:**
- Create: `tools/xtts-server/server.py`
- Create: `tools/xtts-server/requirements.txt`
- Create: `tools/xtts-server/README.md`
- Create: `tools/xtts-server/voices/.gitkeep`

- [ ] **Step 1: `requirements.txt`**

```
coqui-tts>=0.25,<0.27
fastapi>=0.111,<1
uvicorn>=0.30,<1
```

- [ ] **Step 2: `server.py`**

```python
"""Ince XTTS-v2 sunucusu: OpenAI-uyumlu /v1/audio/speech endpoint'i.

Kullanım:  python server.py --lang tr --port 8020
Sesler:    voices/<ad>.wav — her wav bir ses (XTTS referans/klon örneği, 6-30 sn temiz kayıt).
Panel:     Ayarlar → Bağlantı ekle → adres http://localhost:8020/v1, ses adı = dosya adı.
"""
import argparse
import os
import tempfile
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS

VOICES_DIR = Path(__file__).parent / "voices"
DEFAULT_LANG = os.environ.get("XTTS_LANG", "tr")

app = FastAPI(title="xtts-server")
_tts: TTS | None = None


def get_tts() -> TTS:
    global _tts
    if _tts is None:
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"[xtts-server] model yükleniyor (device={device})…")
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    return _tts


class SpeechRequest(BaseModel):
    input: str
    voice: str
    model: str = "xtts-v2"          # uyumluluk için kabul edilir, kullanılmaz
    language: str | None = None     # OpenAI şemasına ek alan; yoksa DEFAULT_LANG
    response_format: str = "wav"    # yalnızca wav desteklenir


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    ref = VOICES_DIR / f"{req.voice}.wav"
    if not ref.exists():
        raise HTTPException(404, f"ses bulunamadı: voices/{req.voice}.wav dosyasını ekleyin")
    if req.response_format != "wav":
        raise HTTPException(400, "yalnızca response_format=wav desteklenir")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name
    try:
        get_tts().tts_to_file(
            text=req.input, speaker_wav=str(ref),
            language=req.language or DEFAULT_LANG, file_path=out_path,
        )
        return Response(content=Path(out_path).read_bytes(), media_type="audio/wav")
    finally:
        os.unlink(out_path)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--lang", default=DEFAULT_LANG)
    p.add_argument("--port", type=int, default=8020)
    args = p.parse_args()
    DEFAULT_LANG = args.lang
    get_tts()  # modeli açılışta yükle (ilk istek beklemesin)
    uvicorn.run(app, host="127.0.0.1", port=args.port)
```

- [ ] **Step 3: `README.md`** (İngilizce; kök README zaten iki dilli bölüm alacak)

```markdown
# xtts-server

Thin local XTTS-v2 server exposing an OpenAI-compatible `POST /v1/audio/speech`
endpoint, so the panel's existing OpenAI-compatible TTS adapter can use it directly.

## Setup

```bash
cd tools/xtts-server
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Voices

Drop reference recordings into `voices/` — one clean 6-30 s WAV per voice.
The file name is the voice name (e.g. `voices/kaan.wav` → voice `kaan`).
XTTS clones the voice in the reference recording.

## Run

```bash
python server.py --lang tr --port 8020
```

First run downloads the XTTS-v2 weights from Hugging Face (~2 GB).
**License note:** XTTS-v2 weights are under the Coqui CPML (non-commercial) license.

## Connect the panel

Settings → Connections → add: address `http://localhost:8020/v1`, any model name,
then add voices matching your WAV file names.
```

- [ ] **Step 4: `voices/.gitkeep`** — boş dosya; `voices/*.wav` kullanıcı verisidir, `.gitignore`'a `tools/xtts-server/voices/*.wav` satırı ekle.

- [ ] **Step 5: Kurulum + sunucu duman testi** (M4'te)

```bash
cd tools/xtts-server && python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
# herhangi bir temiz tr kayıt: voices/deneme.wav
python server.py --lang tr
# ikinci terminal:
curl -s -X POST localhost:8020/v1/audio/speech -H 'Content-Type: application/json' \
  -d '{"voice":"deneme","input":"Merhaba, bu bir deneme."}' -o /tmp/deneme.wav && afplay /tmp/deneme.wav
```

Beklenen: WAV üretilir, ses referans kaydına benzer. Üretim süresini not et (Risk 2 ölçümü).

- [ ] **Step 6: Panelden uçtan uca** — Ayarlar → Bağlantı ekle (`http://localhost:8020/v1`) → ses ekle (`deneme`) → bir bölümde LM Studio ile annotate → bu bağlantıyla üret → dinle.

- [ ] **Step 7: Commit**

```bash
git add tools/xtts-server .gitignore
git commit -m "feat(tts): ince XTTS-v2 sunucusu — OpenAI-uyumlu /v1/audio/speech"
```

---

### Task 7: README (EN + TR parite)

**Files:**
- Modify: `README.md`
- Modify: `README.tr.md`

- [ ] **Step 1: `README.md`'ye "Fully local setup (no API keys)" bölümü ekle** (kurulum bölümünün ardına)

```markdown
## Fully local setup (no API keys)

Run both the annotation LLM and TTS on your own machine — nothing leaves it.

1. **LLM — LM Studio** (or Ollama, or any OpenAI-compatible server):
   load a model (e.g. `openai/gpt-oss-20b`) and start the local server
   (LM Studio serves at `http://localhost:1234/v1`).
   In **Settings → LLM**, pick *OpenAI-compatible*, set the address and model name.
2. **TTS — XTTS-v2** (natural, voice cloning, Turkish support):
   see [`tools/xtts-server/`](tools/xtts-server/README.md). Start it, then add a
   connection in **Settings** with address `http://localhost:8020/v1` and voices
   named after your reference WAV files.
   *Lighter alternative:* [Piper](https://github.com/rhasspy/piper) is built in —
   fast even on CPU, at the cost of a flatter voice.
3. Prefer cloud quality later? Just switch the provider back in Settings —
   local and API providers coexist.

License note: XTTS-v2 model weights use the Coqui CPML (non-commercial) license;
this repo stays MIT and does not ship the weights.
```

- [ ] **Step 2: `README.tr.md`'ye birebir çevirisini ekle** (aynı konuma)

```markdown
## Tamamen lokal kurulum (API anahtarsız)

Hem annotation LLM'ini hem TTS'i kendi makinende çalıştır — hiçbir veri dışarı çıkmaz.

1. **LLM — LM Studio** (veya Ollama, ya da OpenAI-uyumlu herhangi bir sunucu):
   bir model yükle (ör. `openai/gpt-oss-20b`) ve lokal sunucuyu başlat
   (LM Studio `http://localhost:1234/v1` adresinde sunar).
   **Ayarlar → LLM**'den *OpenAI-uyumlu*'yu seç, adres ve model adını gir.
2. **TTS — XTTS-v2** (doğal, ses klonlamalı, Türkçe destekli):
   bkz. [`tools/xtts-server/`](tools/xtts-server/README.md). Başlat, sonra
   **Ayarlar**'dan `http://localhost:8020/v1` adresiyle bağlantı ekle ve referans
   WAV dosya adlarıyla sesleri tanımla.
   *Hafif alternatif:* [Piper](https://github.com/rhasspy/piper) yerleşik —
   CPU'da bile hızlı, karşılığında daha düz bir ses.
3. Sonradan bulut kalitesi mi istedin? Ayarlar'dan sağlayıcıyı değiştirmen yeter —
   lokal ve API sağlayıcıları bir arada yaşar.

Lisans notu: XTTS-v2 model ağırlıkları Coqui CPML (ticari olmayan) lisanslıdır;
bu repo MIT kalır ve ağırlıkları içermez.
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.tr.md
git commit -m "docs(readme): tamamen lokal kurulum bölümü (EN+TR)"
```

---

### Task 8: Son doğrulama

- [ ] **Step 1: Tüm test paketi + tip denetimi**

Run: `npm test && npx tsc --noEmit` — Beklenen: hepsi PASS, tip hatası yok.

- [ ] **Step 2: Uçtan uca lokal akış teyidi** (Task 6 Step 6 zaten yaptıysa atla): LM Studio → annotate → XTTS → dinleme. Süre/kalite notlarını kullanıcıyla paylaş (Risk 1-2 değerlendirmesi).

- [ ] **Step 3: CLAUDE.md güncelle** — Durum bölümüne Dilim E satırı + spec yolu ekle; commit:

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — dilim E durumu"
```
