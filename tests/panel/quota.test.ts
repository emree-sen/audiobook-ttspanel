import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { setSetting } from '@/lib/services/settings';
import { activeProvider, quotaDay, quotaLimit, recordCall, remainingToday, usedToday } from '@/lib/services/quota';

describe('quotaDay', () => {
  test('gemini PT sınırı: kışın UTC 08:00 gün dönümü', () => {
    expect(quotaDay('gemini', Date.UTC(2026, 0, 15, 7, 59))).toBe('2026-01-14');
    expect(quotaDay('gemini', Date.UTC(2026, 0, 15, 8, 1))).toBe('2026-01-15');
  });
  test('bilinmeyen sağlayıcı UTC sayar', () => {
    expect(quotaDay('mock', Date.UTC(2026, 6, 17, 23, 59))).toBe('2026-07-17');
    expect(quotaDay('mock', Date.UTC(2026, 6, 18, 0, 1))).toBe('2026-07-18');
  });
});

describe('kota defteri', () => {
  test('record + usedToday + remaining; başarısız çağrı da sayılır', () => {
    const db = createDb(':memory:');
    expect(usedToday(db, 'gemini')).toBe(0);
    recordCall(db, { provider: 'gemini', segmentId: 'seg_x', usd: 0.001 });
    recordCall(db, { provider: 'gemini', ok: false });
    expect(usedToday(db, 'gemini')).toBe(2);
    expect(quotaLimit(db, 'gemini')).toBe(100);
    expect(remainingToday(db, 'gemini')).toBe(98);
  });
  test('limit settings ile değişir; mock limitsiz (null)', () => {
    const db = createDb(':memory:');
    setSetting(db, 'quota_limit_gemini', '1000');
    expect(quotaLimit(db, 'gemini')).toBe(1000);
    expect(quotaLimit(db, 'mock')).toBeNull();
    expect(remainingToday(db, 'mock')).toBeNull();
  });
  test('dünkü çağrı bugüne sayılmaz', () => {
    const db = createDb(':memory:');
    recordCall(db, { provider: 'gemini', at: Date.now() - 48 * 3600 * 1000 });
    expect(usedToday(db, 'gemini')).toBe(0);
  });
});

describe('activeProvider', () => {
  test('settings > env > varsayılan', () => {
    const db = createDb(':memory:');
    const saved = { p: process.env.TTS_PROVIDER, m: process.env.TTS_MODEL };
    delete process.env.TTS_PROVIDER; delete process.env.TTS_MODEL;
    try {
      expect(activeProvider(db)).toEqual({ name: 'gemini', model: '' });
      process.env.TTS_PROVIDER = 'mock';
      expect(activeProvider(db).name).toBe('mock');
      setSetting(db, 'provider', 'gemini');
      setSetting(db, 'model', 'x-model');
      expect(activeProvider(db)).toEqual({ name: 'gemini', model: 'x-model' });
    } finally {
      if (saved.p) process.env.TTS_PROVIDER = saved.p; else delete process.env.TTS_PROVIDER;
      if (saved.m) process.env.TTS_MODEL = saved.m; else delete process.env.TTS_MODEL;
    }
  });
});
