import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '@/lib/db/client';
import { listeningProgress } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript } from '@/lib/services/scripts';
import { enqueueJob, runJob, stitchLatest } from '@/lib/services/producer';
import { getLibrary, saveProgress } from '@/lib/services/library';
import { MockAdapter } from '@/src/core/tts/mock';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

async function makeDone(db: Db, projectId: string, title: string) {
  const c = createChapter(db, projectId, { title });
  importScript(db, c.id, FIXTURE);
  const job = enqueueJob(db, c.id);
  await runJob(db, job.id, new MockAdapter());
  await stitchLatest(db, c.id); // status: done + render
  return c;
}

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('getLibrary', () => {
  test('yalnız done+voiced listelenir; done son render + süre taşır; boş seri düşer', async () => {
    const p = createProject(db, { title: 'Roman' });
    const done = await makeDone(db, p.id, 'B1');
    const voiced = createChapter(db, p.id, { title: 'B2' });
    importScript(db, voiced.id, FIXTURE);
    const j = enqueueJob(db, voiced.id);
    await runJob(db, j.id, new MockAdapter()); // voiced (stitch yok)
    createChapter(db, p.id, { title: 'B3' }); // draft — görünmez
    createProject(db, { title: 'Boş Seri' }); // bölümsüz — düşer

    const lib = getLibrary(db);
    expect(lib).toHaveLength(1);
    expect(lib[0].project.title).toBe('Roman');
    expect(lib[0].chapters.map((c) => c.status)).toEqual(['done', 'voiced']);
    const d = lib[0].chapters[0];
    expect(d.renderPath).toMatch(new RegExp(`^${done.id}/rnd_`));
    expect(d.durationSec).toBeGreaterThan(0);
    expect(lib[0].chapters[1].renderPath).toBeNull(); // voiced: oynatılamaz
  });
  test('progress join: kayıt varsa progressSec + progressUpdatedAt dolar', async () => {
    const p = createProject(db, { title: 'R' });
    const c = await makeDone(db, p.id, 'B1');
    saveProgress(db, c.id, { positionSec: 42.5, durationSec: 120 });
    const row = getLibrary(db)[0].chapters[0];
    expect(row.progressSec).toBe(42.5);
    expect(row.progressUpdatedAt).toBeGreaterThan(0);
  });
});

describe('saveProgress', () => {
  test('upsert: ikinci yazış günceller; durationSec verilmezse eskisi korunur', async () => {
    const p = createProject(db, { title: 'R' });
    const c = await makeDone(db, p.id, 'B1');
    saveProgress(db, c.id, { positionSec: 10, durationSec: 100 });
    saveProgress(db, c.id, { positionSec: 20 });
    const row = getLibrary(db)[0].chapters[0];
    expect(row.progressSec).toBe(20);
    // durationSec tabloda korunur (getLibrary render süresini döner; tablo değeri doğrudan sorgulanır)
    const stored = db.select().from(listeningProgress).where(eq(listeningProgress.chapterId, c.id)).get()!;
    expect(stored.positionSec).toBe(20);
    expect(stored.durationSec).toBe(100); // ikinci çağrı durationSec vermedi — eskisi korunur
  });
  test('bilinmeyen bölüm Türkçe hata', () => {
    expect(() => saveProgress(db, 'chp_yok', { positionSec: 1 })).toThrow(/bulunamadı/i);
  });
});
