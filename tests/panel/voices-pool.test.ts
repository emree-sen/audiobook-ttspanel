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
