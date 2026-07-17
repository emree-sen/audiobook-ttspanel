import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { audioDir } from '@/lib/config';
import { safeAudioPath } from '@/lib/paths';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import * as generateRoute from '@/app/api/chapters/[id]/generate/route';
import * as audioRoute from '@/app/api/audio/[...path]/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-api-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

describe('safeAudioPath', () => {
  test('normal yol audioDir altında döner', () => {
    expect(safeAudioPath(['chp_1', 'rnd_1.mp3'])).toBe(join(audioDir(), 'chp_1', 'rnd_1.mp3'));
  });
  test('.. ile kaçış null döner', () => {
    expect(safeAudioPath(['..', 'app.db'])).toBeNull();
    expect(safeAudioPath(['chp_1', '..', '..', 'x'])).toBeNull();
  });
});

describe('generate: kuyruğa alma (202)', () => {
  // NOT: eski SSE sözleşmesinin yerini aldı; producer.test.ts davranış sözleşmesini kapsıyor.
  // Task 5, generate rotasının tam yeni test paketini yazacak (bu placeholder geçicidir).
  test('scripti olan bölümde 202 + jobId döner', async () => {
    setSetting(db, 'provider', 'mock');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    importScript(db, c.id, FIXTURE);

    const res = await generateRoute.POST(new Request('http://p', { method: 'POST' }), ctx({ id: c.id }));
    expect(res.status).toBe(202);
    const out = await res.json();
    expect(out.jobId).toEqual(expect.any(String));
  });

  test('script yoksa 400', async () => {
    setSetting(db, 'provider', 'mock');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    const res = await generateRoute.POST(new Request('http://p', { method: 'POST' }), ctx({ id: c.id }));
    expect(res.status).toBe(400);
  });
});

describe('audio servis', () => {
  test('audio: traversal 404', async () => {
    const res = await audioRoute.GET(new Request('http://p'), ctx({ path: ['..', 'app.db'] }));
    expect(res.status).toBe(404);
  });

  test('audio: olmayan dosya 404', async () => {
    const res = await audioRoute.GET(new Request('http://p'), ctx({ path: ['chp_yok', 'x.mp3'] }));
    expect(res.status).toBe(404);
  });
});
