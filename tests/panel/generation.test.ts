import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { adapterFromSettings, generateChapter, listRenders } from '@/lib/services/generation';
import { setSetting } from '@/lib/services/settings';
import { MockAdapter } from '@/src/core/tts/mock';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '@/src/core/types';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-gen-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}

describe('generateChapter (mock adapter)', () => {
  test('başarılı üretim: mp3 dosyası + renders satırı + tüm segmentler done + bölüm done', async () => {
    const { db, chapterId } = setup();
    const progress: [number, number][] = [];
    const out = await generateChapter(db, chapterId, new MockAdapter(), (d, t) => progress.push([d, t]));

    expect(out.segmentCount).toBe(5);
    expect(out.failedCount).toBe(0);
    expect(progress.at(-1)).toEqual([5, 5]);
    expect(existsSync(join(audioDir(), out.renderPath))).toBe(true);

    const renders = listRenders(db, chapterId);
    expect(renders).toHaveLength(1);
    expect(renders[0].path).toBe(out.renderPath);

    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.every((s) => s.status === 'done')).toBe(true);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('kısmi hata: başarısız segment failed+error, bölüm yine done', async () => {
    const { db, chapterId } = setup();
    const inner = new MockAdapter();
    let call = 0;
    const flaky: TtsAdapter = {
      id: 'flaky',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        if (++call === 2) return Promise.reject(new Error('kota doldu'));
        return inner.synthesize(req);
      },
    };
    const out = await generateChapter(db, chapterId, flaky);
    expect(out.failedCount).toBe(1);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs[1].status).toBe('failed');
    expect(segs[1].error).toMatch(/kota doldu/);
    expect(segs.filter((s) => s.status === 'done')).toHaveLength(4);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('script yoksa fırlatır', async () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    await expect(generateChapter(db, c.id, new MockAdapter())).rejects.toThrow(/script/i);
  });

  test('hiç segment üretilemezse bölüm error olur', async () => {
    const { db, chapterId } = setup();
    const broken: TtsAdapter = { id: 'broken', synthesize: () => Promise.reject(new Error('patladı')) };
    await expect(generateChapter(db, chapterId, broken)).rejects.toThrow();
    expect(getChapter(db, chapterId)?.status).toBe('error');
    expect(listRenders(db, chapterId)).toHaveLength(0);

    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.every((s) => s.status === 'failed')).toBe(true);
    expect(segs.every((s) => s.error?.match(/patladı/))).toBe(true);
  });

  test('single_voice ayarı tüm segment seslerini değiştirir (mock üstünden gözlem)', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'single_voice', 'gemini:Charon');
    const seen: string[] = [];
    const inner = new MockAdapter();
    const spy: TtsAdapter = {
      id: 'spy',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> { seen.push(req.voice.providerVoice); return inner.synthesize(req); },
    };
    await generateChapter(db, chapterId, spy);
    expect(new Set(seen)).toEqual(new Set(['Charon']));
  });
});

describe('adapterFromSettings', () => {
  test('provider=mock ayarıyla MockAdapter döner', () => {
    const db = createDb(':memory:');
    setSetting(db, 'provider', 'mock');
    expect(adapterFromSettings(db).id).toBe('mock');
  });

  test('gemini + anahtar yoksa Türkçe hata', () => {
    const db = createDb(':memory:');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(() => adapterFromSettings(db)).toThrow(/GEMINI_API_KEY/);
    } finally { if (saved) process.env.GEMINI_API_KEY = saved; }
  });
});
