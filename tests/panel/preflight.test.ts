import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { audioCache } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { planChapter, preflightChapter, segmentHash } from '@/lib/services/preflight';
import { supportsStyle } from '@/lib/services/generation';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}

describe('segmentHash', () => {
  test('deterministik; her girdi hash\'i değiştirir', () => {
    const base = { provider: 'gemini', model: 'm', voice: 'gemini:Charon', style: 's', language: 'tr-TR', text: 'merhaba' };
    expect(segmentHash(base)).toBe(segmentHash({ ...base }));
    expect(segmentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const patch of [{ provider: 'x' }, { model: 'x' }, { voice: 'x:Y' }, { style: 'x' }, { text: 'x' }, { tags: ['[a]'] }]) {
      expect(segmentHash({ ...base, ...patch })).not.toBe(segmentHash(base));
    }
  });
});

describe('planChapter', () => {
  test('stil birleşimi orkestratör kuralıyla aynı; pause korunur', () => {
    const { db, chapterId } = setup();
    const { plan } = planChapter(db, chapterId);
    expect(plan).toHaveLength(5);
    // fixture s1: narrator base_style "sakin, ölçülü, üçüncü şahıs anlatım" + style "gizemli, yavaş"
    expect(plan[0].style).toBe('sakin, ölçülü, üçüncü şahıs anlatım, gizemli, yavaş');
    expect(plan[0].pauseAfterMs).toBe(400);
    expect(plan[0].voiceId).toBe('gemini:Charon');
  });
  test('single_voice tüm hash\'leri değiştirir', () => {
    const { db, chapterId } = setup();
    const before = planChapter(db, chapterId).plan.map((p) => p.hash);
    setSetting(db, 'single_voice', 'gemini:Iapetus');
    const after = planChapter(db, chapterId).plan.map((p) => p.hash);
    expect(after.every((h, i) => h !== before[i])).toBe(true);
  });
  test('script yoksa Türkçe hata', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect(() => planChapter(db, c.id)).toThrow(/script/i);
  });
});

describe('preflightChapter', () => {
  test('boş cache: newCalls=total; gemini varsayılan kota 100 ile fits', () => {
    const { db, chapterId } = setup();
    const pf = preflightChapter(db, chapterId);
    expect(pf).toMatchObject({ total: 5, cached: 0, newCalls: 5, fits: true });
    expect(pf.quota).toMatchObject({ provider: 'gemini', used: 0, limit: 100, remaining: 100 });
  });
  test('cache isabeti düşer', () => {
    const { db, chapterId } = setup();
    const { plan } = planChapter(db, chapterId);
    db.insert(audioCache).values({ hash: plan[0].hash, path: `segments/${plan[0].hash}.wav`, durationMs: 100, usd: 0, createdAt: 1 }).run();
    const pf = preflightChapter(db, chapterId);
    expect(pf.cached).toBe(1);
    expect(pf.newCalls).toBe(4);
  });
  test('kota yetmezse fits=false', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'quota_limit_gemini', '3');
    const pf = preflightChapter(db, chapterId);
    expect(pf.fits).toBe(false);
    expect(pf.quota?.remaining).toBe(3);
  });
  test('mock sağlayıcı: quota null, fits true', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock');
    const pf = preflightChapter(db, chapterId);
    expect(pf.quota).toBeNull();
    expect(pf.fits).toBe(true);
  });
});

describe('stil düşürme (yetenek bildirimi)', () => {
  test('piper: plan stilsiz; hash stilsiz formülle birebir', () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'piper');
    const { script, plan } = planChapter(db, chapterId);
    expect(plan.every((p) => p.style === undefined && p.tags === undefined)).toBe(true);
    expect(plan[0].hash).toBe(segmentHash({
      provider: 'piper', model: '', voice: plan[0].voiceId,
      language: script.language, text: plan[0].text,
    }));
  });
  test('preflight: supportsStyle=false + styledSegments>0 (piper); gemini true', () => {
    const { db, chapterId } = setup();
    expect(preflightChapter(db, chapterId).supportsStyle).toBe(true);
    setSetting(db, 'provider', 'piper');
    const pf = preflightChapter(db, chapterId);
    expect(pf.supportsStyle).toBe(false);
    expect(pf.styledSegments).toBeGreaterThan(0); // fixture'da stilli segmentler var
  });
});
