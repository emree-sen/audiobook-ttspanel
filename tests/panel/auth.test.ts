import { afterEach, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { createToken, verifyToken } from '@/lib/auth';
import { POST as login } from '@/app/api/auth/login/route';

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

describe('POST /api/auth/login (tServer)', () => {
  const loginReq = (password: string, cookie?: string) =>
    new NextRequest('http://p/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `lang=${cookie}` } : {}) },
      body: JSON.stringify({ password }),
    });

  afterEach(() => { delete process.env.PANEL_PASSWORD; });

  test('hatalı şifre: TR cookie ile TR, cookiesiz EN', async () => {
    process.env.PANEL_PASSWORD = 'gizli-sifre';
    const trRes = await login(loginReq('yanlis', 'tr'));
    expect(trRes.status).toBe(401);
    expect((await trRes.json()).error).toBe('Hatalı şifre');

    const enRes = await login(loginReq('yanlis'));
    expect(enRes.status).toBe(401);
    expect((await enRes.json()).error).toBe('Wrong password');
  });

  test('PANEL_PASSWORD tanımsızsa 400 (dile göre mesaj)', async () => {
    delete process.env.PANEL_PASSWORD;
    const res = await login(loginReq('herhangi', 'tr'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PANEL_PASSWORD ayarlı değil; auth kapalı');
  });
});
