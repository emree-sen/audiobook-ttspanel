import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { enqueueJob, runJob, stitchLatest } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';
import * as libraryRoute from '@/app/api/library/route';
import * as progressRoute from '@/app/api/progress/[chapterId]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (chapterId: string) => ({ params: Promise.resolve({ chapterId }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let db: Db, chapterId: string;
beforeEach(async () => {
  db = createDb(':memory:'); setDbForTests(db);
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  chapterId = c.id;
  importScript(db, c.id, FIXTURE);
  const job = enqueueJob(db, c.id);
  await runJob(db, job.id, new MockAdapter());
  await stitchLatest(db, c.id);
});

describe('GET /api/library', () => {
  test('serileri ve oynatılabilir bölümü döner', async () => {
    const lib = await (await libraryRoute.GET()).json();
    expect(lib).toHaveLength(1);
    expect(lib[0].chapters[0].renderPath).toBeTruthy();
  });
});

describe('PUT /api/progress/[chapterId]', () => {
  test('kaydeder; library yanıtına yansır', async () => {
    const res = await progressRoute.PUT(jsonReq('PUT', { positionSec: 33, durationSec: 90 }), ctx(chapterId));
    expect(res.status).toBe(200);
    const lib = await (await libraryRoute.GET()).json();
    expect(lib[0].chapters[0].progressSec).toBe(33);
  });
  test('geçersiz sayı 400 (negatif, sonsuz, eksik); bilinmeyen bölüm 404', async () => {
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: -1 }), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', {}), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: Infinity }), ctx(chapterId))).status).toBe(400);
    expect((await progressRoute.PUT(jsonReq('PUT', { positionSec: 5 }), ctx('chp_yok'))).status).toBe(404);
  });
});
