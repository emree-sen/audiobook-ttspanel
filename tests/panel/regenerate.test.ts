import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { ttsCalls } from '@/lib/db/schema';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { listRenders } from '@/lib/services/generation';
import { enqueueJob, regenerateSegment, runJob } from '@/lib/services/producer';
import { MockAdapter } from '@/src/core/tts/mock';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wnt-regen-')); process.env.DATA_DIR = tmp; });
afterAll(() => { delete process.env.DATA_DIR; rmSync(tmp, { recursive: true, force: true }); });

async function setupProduced() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  importScript(db, c.id, FIXTURE);
  await runJob(db, enqueueJob(db, c.id).id, new MockAdapter());
  return { db, chapterId: c.id };
}

describe('regenerateSegment', () => {
  test('1 çağrı + yeni render; diğer segmentlere çağrı yok', async () => {
    const { db, chapterId } = await setupProduced();
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[1];
    const before = db.select().from(ttsCalls).all().length; // 5
    const out = await regenerateSegment(db, seg.id, new MockAdapter());
    expect(db.select().from(ttsCalls).all().length).toBe(before + 1);
    expect(listRenders(db, chapterId)).toHaveLength(2);
    expect(out.renderId).toMatch(/^rnd_/);
    expect(listSegments(db, latestScript(db, chapterId)!.id)[1].status).toBe('done');
  });

  test('bilinmeyen segment / aktif iş / kota 0 → Türkçe hatalar', async () => {
    const { db, chapterId } = await setupProduced();
    await expect(regenerateSegment(db, 'seg_yok', new MockAdapter())).rejects.toThrow(/Segment bulunamadı/);

    enqueueJob(db, chapterId); // aktif iş (queued)
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[0];
    await expect(regenerateSegment(db, seg.id, new MockAdapter())).rejects.toThrow(/aktif.*iş/i);
  });

  test('kota dolmuşsa reddeder', async () => {
    const { db, chapterId } = await setupProduced(); // 5 çağrı harcandı (provider: gemini varsayılan)
    setSetting(db, 'quota_limit_gemini', '5');
    const seg = listSegments(db, latestScript(db, chapterId)!.id)[0];
    await expect(regenerateSegment(db, seg.id, new MockAdapter())).rejects.toThrow(/kota doldu/i);
  });
});
