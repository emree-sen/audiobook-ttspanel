import { beforeEach, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { getSetting, setSetting } from '@/lib/services/settings';
import * as settingsRoute from '@/app/api/settings/route';
import * as connectionsRoute from '@/app/api/connections/route';
import * as connectionRoute from '@/app/api/connections/[id]/route';
import * as voicesRoute from '@/app/api/voices/route';
import * as voiceRoute from '@/app/api/voices/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new NextRequest('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

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
