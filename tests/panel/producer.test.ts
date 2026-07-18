import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { jobs, ttsCalls } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { listRenders } from '@/lib/services/generation';
import { enqueueJob, ensureWorker, latestJob, recoverJobs, resumeJob, runJob, synthesizeChecked } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '@/src/core/types';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-prod-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  return { db, chapterId: c.id };
}
const callCount = (db: ReturnType<typeof createDb>) => db.select().from(ttsCalls).all().length;

describe('enqueueJob', () => {
  test('script yoksa Türkçe hata; aktif işi iptal eder', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect(() => enqueueJob(db, c.id)).toThrow(/script/i);
    importScript(db, c.id, FIXTURE);
    const j1 = enqueueJob(db, c.id);
    const j2 = enqueueJob(db, c.id);
    expect(db.select().from(jobs).where(eq(jobs.id, j1.id)).get()?.status).toBe('canceled');
    expect(j2.status).toBe('queued');
    expect(j2.totalCount).toBe(5);
    expect(getChapter(db, c.id)?.status).toBe('generating');
  });
});

describe('runJob', () => {
  test('tam üretim: segment dosyaları + cache + render + job/chapter done', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId);
    await runJob(db, job.id, new MockAdapter());
    const j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'done', doneCount: 5, callsUsed: 5 });
    expect(callCount(db)).toBe(5);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.every((s) => s.status === 'done' && s.audioPath?.startsWith('segments/') && s.contentHash)).toBe(true);
    expect(existsSync(join(audioDir(), segs[0].audioPath!))).toBe(true);
    expect(listRenders(db, chapterId)).toHaveLength(1);
    expect(getChapter(db, chapterId)?.status).toBe('done');
  });

  test('ikinci üretim tamamen cache\'ten: 0 yeni çağrı', async () => {
    const { db, chapterId } = setup();
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    const before = callCount(db);
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    expect(callCount(db)).toBe(before);
    expect(latestJob(db, chapterId)!.status).toBe('done');
    expect(listRenders(db, chapterId)).toHaveLength(2);
  });

  test('limitCalls: tavana gelince duraklar; resume limitsiz tamamlar', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId, { limitCalls: 2 });
    await runJob(db, job.id, new MockAdapter());
    let j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'queued', pausedReason: 'limit', callsUsed: 2, doneCount: 2 });
    expect(getChapter(db, chapterId)?.status).toBe('generating');
    const resumed = resumeJob(db, j.id);
    expect(resumed.limitCalls).toBeNull();
    await runJob(db, j.id, new MockAdapter());
    j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'done', doneCount: 5, callsUsed: 5 });
  });

  test('kota dolunca pausedReason=quota ile duraklar', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'quota_limit_gemini', '3'); // activeProvider varsayılanı gemini
    await runJob(db, enqueueJob(db, chapterId).id, new MockAdapter());
    const j = latestJob(db, chapterId)!;
    expect(j).toMatchObject({ status: 'queued', pausedReason: 'quota', doneCount: 3 });
  });

  test('segment hatası: failed + iş sürer + render oluşur', async () => {
    const { db, chapterId } = setup();
    const inner = new MockAdapter();
    let n = 0;
    const flaky: TtsAdapter = {
      id: 'flaky',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        if (++n === 2) return Promise.reject(new Error('kota doldu'));
        return inner.synthesize(req);
      },
    };
    await runJob(db, enqueueJob(db, chapterId).id, flaky);
    const segs = listSegments(db, latestScript(db, chapterId)!.id);
    expect(segs.filter((s) => s.status === 'failed')).toHaveLength(1);
    expect(segs[1].error).toMatch(/kota doldu/);
    expect(latestJob(db, chapterId)!.status).toBe('done');
    expect(listRenders(db, chapterId)).toHaveLength(1);
    expect(callCount(db)).toBe(5); // başarısız da defterde
  });

  test('hepsi başarısız: job + chapter error, render yok', async () => {
    const { db, chapterId } = setup();
    const broken: TtsAdapter = { id: 'broken', synthesize: () => Promise.reject(new Error('patladı')) };
    await runJob(db, enqueueJob(db, chapterId).id, broken);
    expect(latestJob(db, chapterId)!.status).toBe('error');
    expect(getChapter(db, chapterId)?.status).toBe('error');
    expect(listRenders(db, chapterId)).toHaveLength(0);
  });

  test('single_voice üretimde de uygulanır (mock ses adı gözlemi)', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'single_voice', 'gemini:Charon');
    const seen: string[] = [];
    const inner = new MockAdapter();
    const spy: TtsAdapter = {
      id: 'spy',
      synthesize(req: TtsSegmentRequest): Promise<TtsResult> { seen.push(req.voice.providerVoice); return inner.synthesize(req); },
    };
    await runJob(db, enqueueJob(db, chapterId).id, spy);
    expect(new Set(seen)).toEqual(new Set(['Charon']));
  });

  test('koşu sırasında iptal: kota harcaması durur, iş done\'a dirilmez', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId);
    const inner = new MockAdapter();
    let n = 0;
    const cancelling: TtsAdapter = {
      id: 'cancelling',
      async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        if (++n === 2) enqueueJob(db, chapterId); // yeni iş eskisini canceled yapar
        return inner.synthesize(req);
      },
    };
    await runJob(db, job.id, cancelling);
    expect(db.select().from(jobs).where(eq(jobs.id, job.id)).get()?.status).toBe('canceled');
    expect(n).toBeLessThanOrEqual(2); // iptalden sonra çağrı yok
  });

  test('aynı işe eşzamanlı iki runJob: yalnız biri sahiplenir, çağrı sayısı segment sayısını aşmaz', async () => {
    const { db, chapterId } = setup(); // mevcut yardımcı; script 5 segmentli fixture
    let calls = 0;
    const spy = { id: 'mock', async synthesize(req: TtsSegmentRequest) { calls++; return new MockAdapter().synthesize(req); } };
    const job = enqueueJob(db, chapterId);
    await Promise.all([runJob(db, job.id, spy), runJob(db, job.id, spy)]);
    expect(calls).toBe(5); // çift worker olsaydı 10'a çıkardı (KN2 saha bulgusu)
    const fresh = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(fresh.status).toBe('done');
  });
});

describe('stil düşürme (yetenek bildirimi)', () => {
  test('stil desteklemeyen sağlayıcıda synthesize istekleri stilsiz gider', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'piper');
    const seen: { style?: string; tags?: string[] }[] = [];
    const spy: TtsAdapter = {
      id: 'piper',
      capabilities: { style: false },
      async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
        seen.push({ style: req.style, tags: req.tags });
        return new MockAdapter().synthesize(req);
      },
    };
    const job = enqueueJob(db, chapterId);
    await runJob(db, job.id, spy);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.style === undefined && (r.tags === undefined || r.tags.length === 0))).toBe(true);
  });
});

describe('recover + worker', () => {
  test('running kalmış iş queued\'a döner; ensureWorker bitirir', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock'); // adapterFromSettings → MockAdapter (ağ yok)
    const job = enqueueJob(db, chapterId);
    db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job.id)).run(); // çökmüş süreç simülasyonu
    recoverJobs(db);
    expect(latestJob(db, chapterId)!.status).toBe('queued');
    await ensureWorker(db);
    expect(latestJob(db, chapterId)!.status).toBe('done');
  });

  test('senkron biten ensureWorker singleton\'ı zehirlemez (regresyon: c76a0f6)', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock');
    await ensureWorker(db); // hiç iş yok — tamamen senkron yol
    const job = enqueueJob(db, chapterId);
    await ensureWorker(db); // zehirlenmiş olsaydı hiçbir şey yapmazdı
    expect(latestJob(db, chapterId)!.status).toBe('done');
    expect(job.id).toBe(latestJob(db, chapterId)!.id);
  });

  test('ensureWorker duraklamış (pausedReason) işi kendiliğinden sürdürmez', async () => {
    const { db, chapterId } = setup();
    setSetting(db, 'provider', 'mock');
    const job = enqueueJob(db, chapterId, { limitCalls: 1 });
    await ensureWorker(db);
    expect(latestJob(db, chapterId)!).toMatchObject({ status: 'queued', pausedReason: 'limit', doneCount: 1 });
    await ensureWorker(db); // tekrar çağrı — hâlâ duraklı kalmalı
    expect(latestJob(db, chapterId)!.doneCount).toBe(1);
  });
});

describe('synthesizeChecked (KN1 süre bekçisi)', () => {
  const req = { text: 'Kısa bir cümle.', voice: { provider: 'mock', providerVoice: 'x' }, language: 'tr-TR' };
  const fake = (durations: number[], failFrom = Infinity): TtsAdapter => {
    let i = 0;
    return { id: 'fake', async synthesize() {
      if (i >= failFrom) { i++; throw new Error('deneme patladı'); }
      const d = durations[Math.min(i++, durations.length - 1)];
      return { audio: Buffer.alloc(4), format: 'wav' as const, durationMs: d, cost: { unit: 'chars' as const, amount: 5, usd: 0 } };
    } };
  };
  test('makul süre: tek deneme', async () => {
    const { result, attempts } = await synthesizeChecked(fake([2000]), req);
    expect(attempts).toBe(1);
    expect(result.durationMs).toBe(2000);
  });
  test('absürt süre: 1 yeniden deneme, kısa sonuç seçilir', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000, 2200]), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(2200);
  });
  test('iki deneme de absürtse kısa olan kullanılır', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000, 20000]), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(14000);
  });
  test('yeniden deneme patlarsa ilk sonuç kullanılır (başarı bozulmaz)', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000], 1), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(14000);
  });
  test('eşik: max(4000, uzunluk*250)', async () => {
    // 15 karakter → tavan 4000 (taban); 4000 üstü tetikler, altı tetiklemez
    const { attempts } = await synthesizeChecked(fake([3900]), req);
    expect(attempts).toBe(1);
  });
});

test('runJob bekçi denemelerini deftere yazar (attempts kadar kayıt + callsUsed)', async () => {
  const { db, chapterId } = setup();
  setSetting(db, 'provider', 'mock');
  // ilk segmentte absürt, sonra normal süre veren adapter
  let n = 0;
  const spy: TtsAdapter = { id: 'mock', async synthesize(req) {
    const base = await new MockAdapter().synthesize(req);
    n++;
    return n === 1 ? { ...base, durationMs: 999999 } : base;
  } };
  const job = enqueueJob(db, chapterId);
  await runJob(db, job.id, spy);
  const calls = db.select().from(ttsCalls).all();
  expect(calls.length).toBe(6); // 5 segment + 1 bekçi denemesi
  const fresh = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
  expect(fresh.callsUsed).toBe(6);
});
