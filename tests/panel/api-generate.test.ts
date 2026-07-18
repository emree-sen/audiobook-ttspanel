import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { safeAudioPath } from '@/lib/paths';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { enqueueJob, ensureWorker } from '@/lib/services/producer';
import * as preflightRoute from '@/app/api/chapters/[id]/preflight/route';
import * as generateRoute from '@/app/api/chapters/[id]/generate/route';
import * as progressRoute from '@/app/api/chapters/[id]/progress/route';
import * as stitchRoute from '@/app/api/chapters/[id]/stitch/route';
import * as resumeRoute from '@/app/api/jobs/[id]/resume/route';
import * as regenRoute from '@/app/api/segments/[id]/regenerate/route';
import * as audioRoute from '@/app/api/audio/[...path]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-api-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); setSetting(db, 'provider', 'mock'); });

function mkChapter() {
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B' });
  importScript(db, c.id, FIXTURE);
  return c.id;
}

describe('safeAudioPath', () => {
  test('normal yol audioDir altında; traversal null', () => {
    expect(safeAudioPath(['chp_1', 'rnd_1.mp3'])).toBe(join(audioDir(), 'chp_1', 'rnd_1.mp3'));
    expect(safeAudioPath(['..', 'app.db'])).toBeNull();
    expect(safeAudioPath(['chp_1', '..', '..', 'x'])).toBeNull();
  });
});

describe('preflight rotası', () => {
  test('script varken hesap; script yokken 400; bölüm yokken 404', async () => {
    const id = mkChapter();
    const pf = await (await preflightRoute.GET(jsonReq('GET'), ctx({ id }))).json();
    expect(pf).toMatchObject({ total: 5, cached: 0, newCalls: 5 });
    expect(pf.quota).toBeNull(); // provider mock → limitsiz

    const p2 = createProject(db, { title: 'R2' });
    const bos = createChapter(db, p2.id, { title: 'B' });
    expect((await preflightRoute.GET(jsonReq('GET'), ctx({ id: bos.id }))).status).toBe(400);
    expect((await preflightRoute.GET(jsonReq('GET'), ctx({ id: 'chp_yok' }))).status).toBe(404);
  });
});

describe('generate + progress + audio', () => {
  test('kuyrukla + worker bitir + progress done (renderId YOK) + stitch + mp3 servis', async () => {
    const id = mkChapter();
    const res = await generateRoute.POST(jsonReq('POST', {}), ctx({ id }));
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    expect(jobId).toMatch(/^job_/);

    await ensureWorker(db); // testte deterministik bekleyiş

    const body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: done');
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]);
    expect(done).toMatchObject({ done: 5, total: 5, failedCount: 0 });
    expect(done.renderId).toBeUndefined();
    expect(done.renderPath).toBeUndefined();

    const st = await stitchRoute.POST(jsonReq('POST'), ctx({ id }));
    expect(st.status).toBe(200);
    const { renderPath } = await st.json();

    const audio = await audioRoute.GET(jsonReq('GET'), ctx({ path: (renderPath as string).split('/') }));
    expect(audio.status).toBe(200);
  });

  test('limitCalls ile duraklar; resume tamamlar', async () => {
    const id = mkChapter(); // provider beforeEach'te mock — limitCalls sağlayıcıdan bağımsız duraklatır
    const res = await generateRoute.POST(jsonReq('POST', { limitCalls: 2 }), ctx({ id }));
    const { jobId } = await res.json();
    await ensureWorker(db);

    let body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: paused');
    expect(body).toContain('"reason":"limit"');

    expect((await resumeRoute.POST(jsonReq('POST'), ctx({ id: jobId }))).status).toBe(200);
    await ensureWorker(db);
    body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id }))).body).text();
    expect(body).toContain('event: done');
  });

  test('script yokken generate 400; iş yokken progress failed', async () => {
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    expect((await generateRoute.POST(jsonReq('POST', {}), ctx({ id: c.id }))).status).toBe(400);
    const body = await new Response((await progressRoute.GET(jsonReq('GET'), ctx({ id: c.id }))).body).text();
    expect(body).toContain('event: failed');
  });
});

describe('regenerate rotası', () => {
  test('başarılı (render YOK, {segmentId,status} döner) + bilinmeyen segment 400', async () => {
    const id = mkChapter();
    await generateRoute.POST(jsonReq('POST', {}), ctx({ id }));
    await ensureWorker(db);
    const seg = listSegments(db, latestScript(db, id)!.id)[0];
    const ok = await regenRoute.POST(jsonReq('POST'), ctx({ id: seg.id }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ segmentId: seg.id, status: 'done' });
    expect((await regenRoute.POST(jsonReq('POST'), ctx({ id: 'seg_yok' }))).status).toBe(400);
  });
});

describe('stitch rotası', () => {
  test('POST /api/chapters/[id]/stitch: render döner; aktif işte 400', async () => {
    const id = mkChapter();
    await generateRoute.POST(jsonReq('POST', {}), ctx({ id }));
    await ensureWorker(db);
    const ok = await stitchRoute.POST(jsonReq('POST'), ctx({ id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).renderId).toMatch(/^rnd_/);

    enqueueJob(db, id); // yeni iş kuyrukta kalsın (worker çalıştırılmadı) — aktif iş
    const bad = await stitchRoute.POST(jsonReq('POST'), ctx({ id }));
    expect(bad.status).toBe(400);
  });
});
