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
