import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenAiCompatLlmAdapter, stripLlmWrappers } from '@/lib/llm/openai';

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
  test('kapatılmamış <think> etiketi de sıyrılır (kesilmiş yanıt)', () => {
    expect(stripLlmWrappers('{"a":1}\n<think>yarıda kesilen düşünce')).toBe('{"a":1}');
  });
});

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
