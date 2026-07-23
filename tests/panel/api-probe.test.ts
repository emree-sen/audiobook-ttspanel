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
    expect(d.models).toEqual(['a', 'b']);
  });

  test('llm: 20 modelden fazlası kırpılır', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}` }));
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ data: many }) }));
    const d = await (await probeRoute.POST(jsonReq({ kind: 'llm', baseUrl: 'http://x/v1' }))).json();
    expect(d.models).toHaveLength(20);
    expect(d.models[0]).toBe('m0');
  });

  test('llm: bozuk /models öğeleri (null vb.) yoksayılır', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ data: [null, { id: 'a' }, { id: 5 }] }) }));
    const d = await (await probeRoute.POST(jsonReq({ kind: 'llm', baseUrl: 'http://x/v1' }))).json();
    expect(d.ok).toBe(true);
    expect(d.models).toEqual(['a']);
  });

  test('tts: /v1 kökünden /health okur, ses sayısını döndürür', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ status: 'ok', voices: ['deneme'], device: 'cpu' }) }; });
    const d = await (await probeRoute.POST(jsonReq({ kind: 'tts', baseUrl: 'http://localhost:8020/v1' }))).json();
    expect(urls[0]).toBe('http://localhost:8020/health');
    expect(d.ok).toBe(true);
    expect(d.detail).toContain('1');
    expect(d.voices).toEqual(['deneme']);
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
