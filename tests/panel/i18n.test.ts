import { describe, expect, it } from 'vitest';
import { tr } from '@/lib/i18n/tr';
import { en } from '@/lib/i18n/en';
import { format, getDict, resolveLang } from '@/lib/i18n';

describe('i18n sözlükleri', () => {
  it('TR ve EN anahtar kümeleri birebir aynı', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
  });
  it('boş çeviri yok', () => {
    for (const d of [tr, en] as const)
      for (const [k, v] of Object.entries(d)) expect(v, k).not.toBe('');
  });
});

describe('resolveLang', () => {
  it('geçerli cookie kazanır', () => {
    expect(resolveLang('en', 'tr-TR,tr;q=0.9')).toBe('en');
    expect(resolveLang('tr', 'en-US')).toBe('tr');
  });
  it('cookie yoksa Accept-Language: tr birincilse tr', () => {
    expect(resolveLang(undefined, 'tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(resolveLang(undefined, 'en-US,en;q=0.9')).toBe('en');
  });
  it('deforme/boş girdi → en', () => {
    expect(resolveLang(undefined, undefined)).toBe('en');
    expect(resolveLang('xx', '')).toBe('en');
  });
});

describe('format', () => {
  it('yer tutucuları doldurur', () => {
    expect(format('Merhaba {name}, {n} bölüm', { name: 'Ada', n: 3 })).toBe('Merhaba Ada, 3 bölüm');
  });
  it('bilinmeyen yer tutucu olduğu gibi kalır', () => {
    expect(format('{x} kaldı', {})).toBe('{x} kaldı');
  });
});

describe('getDict', () => {
  it('dile göre sözlük döner', () => {
    expect(getDict('tr')).toBe(tr);
    expect(getDict('en')).toBe(en);
  });
});
