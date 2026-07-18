import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { addVoice } from '@/lib/services/voices';
import { loadPool, pickVoice } from '@/lib/voices-pool';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('loadPool', () => {
  test('gemini tohumu: 8 ses, ilk Charon, voiceId "provider:voice" biçiminde', () => {
    const pool = loadPool(db, 'gemini');
    expect(pool).toHaveLength(8);
    expect(pool[0].voiceId).toBe('gemini:Charon');
    expect(pool.every((v) => v.voiceId.startsWith('gemini:'))).toBe(true);
  });
  test('başka sağlayıcının havuzu ayrı', () => {
    addVoice(db, { provider: 'sunucum', voice: 'alloy' });
    expect(loadPool(db, 'sunucum').map((v) => v.voiceId)).toEqual(['sunucum:alloy']);
  });
});

describe('pickVoice', () => {
  const pool = (db: Db) => loadPool(db, 'gemini');
  test('cinsiyete uygun + kullanılmamış atar', () => {
    const used = new Set<string>(['gemini:Charon']);
    const v1 = pickVoice(pool(db), 'female', used);
    expect(pool(db).find((v) => v.voiceId === v1)?.gender).toBe('female');
    const v2 = pickVoice(pool(db), 'female', used);
    expect(v2).not.toBe(v1);
  });
  test('unknown cinsiyet ve havuz bitimi fırlatmaz (deterministik döngü)', () => {
    const used = new Set<string>();
    for (let i = 0; i < 12; i++) expect(() => pickVoice(pool(db), 'unknown', used)).not.toThrow();
  });
  test('cinsiyeti tutan ses yoksa tüm havuza düşer (öksüz kalmaz)', () => {
    addVoice(db, { provider: 'notr', voice: 'tek' }); // gender ''
    expect(pickVoice(loadPool(db, 'notr'), 'female', new Set())).toBe('notr:tek');
  });
  test('boş havuz Türkçe hatayla fırlatır', () => {
    expect(() => pickVoice([], 'male', new Set())).toThrow(/havuzu boş/);
  });
});
