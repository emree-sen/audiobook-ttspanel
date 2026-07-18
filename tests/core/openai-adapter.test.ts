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
