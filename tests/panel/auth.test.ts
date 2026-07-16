import { describe, expect, test } from 'vitest';
import { createToken, verifyToken } from '@/lib/auth';

describe('auth token', () => {
  test('üret + doğrula (roundtrip)', async () => {
    const t = await createToken('gizli');
    expect(t).toMatch(/^v1\.\d+\./);
    expect(await verifyToken('gizli', t)).toBe(true);
  });

  test('yanlış secret reddedilir', async () => {
    const t = await createToken('gizli');
    expect(await verifyToken('baska', t)).toBe(false);
  });

  test('süresi dolmuş token reddedilir', async () => {
    const t = await createToken('gizli', Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(await verifyToken('gizli', t)).toBe(false);
  });

  test('çöp/boş token reddedilir', async () => {
    expect(await verifyToken('gizli', undefined)).toBe(false);
    expect(await verifyToken('gizli', 'saçmalık')).toBe(false);
    expect(await verifyToken('gizli', 'v1.123.abc')).toBe(false);
  });

  test('expiry ile oynanmış token reddedilir', async () => {
    const t = await createToken('gizli');
    const [v, , sig] = t.split('.');
    expect(await verifyToken('gizli', `${v}.${Date.now() + 999999999}.${sig}`)).toBe(false);
  });
});
