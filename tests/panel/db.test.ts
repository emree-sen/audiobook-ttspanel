import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/lib/db/client';
import { chapters, projects, segments, scripts } from '@/lib/db/schema';

function mkProject(db: ReturnType<typeof createDb>, id = 'prj_x') {
  db.insert(projects).values({ id, title: 'T', createdAt: 1, updatedAt: 1 }).run();
  return id;
}

describe('db client + şema', () => {
  test(':memory: db açılır, tablolar migrate edilir', () => {
    const db = createDb(':memory:');
    expect(db.select().from(projects).all()).toEqual([]);
  });

  test('cascade: proje silinince bölüm+script+segment silinir', () => {
    const db = createDb(':memory:');
    const pid = mkProject(db);
    db.insert(chapters).values({ id: 'chp_x', projectId: pid, position: 1, title: 'B1', createdAt: 1, updatedAt: 1 }).run();
    db.insert(scripts).values({ id: 'scr_x', chapterId: 'chp_x', version: 1, source: 'manual', json: '{}', createdAt: 1 }).run();
    db.insert(segments).values({ id: 'seg_x', chapterId: 'chp_x', scriptId: 'scr_x', idx: 0, speaker: 'n', text: 't', voice: 'gemini:Charon', createdAt: 1, updatedAt: 1 }).run();

    db.delete(projects).where(eq(projects.id, pid)).run();
    expect(db.select().from(chapters).all()).toEqual([]);
    expect(db.select().from(scripts).all()).toEqual([]);
    expect(db.select().from(segments).all()).toEqual([]);
  });

  test('FK ihlali reddedilir (foreign_keys pragma açık)', () => {
    const db = createDb(':memory:');
    expect(() =>
      db.insert(chapters).values({ id: 'chp_y', projectId: 'yok', position: 1, title: 'B', createdAt: 1, updatedAt: 1 }).run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
