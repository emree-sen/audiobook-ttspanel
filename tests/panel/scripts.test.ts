import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { importScript, latestScript, listSegments } from '@/lib/services/scripts';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  return { db, chapterId: c.id };
}

describe('importScript', () => {
  test('geçerli script: satırlar yazılır, status scripted', () => {
    const { db, chapterId } = setup();
    const r = importScript(db, chapterId, FIXTURE);
    expect(r.version).toBe(1);
    expect(r.segmentCount).toBe(5);
    const scr = latestScript(db, chapterId)!;
    expect(scr.id).toBe(r.scriptId);
    expect(scr.source).toBe('manual');
    const segs = listSegments(db, scr.id);
    expect(segs).toHaveLength(5);
    expect(segs[0]).toMatchObject({ idx: 0, speaker: 'narrator', voice: 'gemini:Charon', status: 'pending' });
    expect(getChapter(db, chapterId)?.status).toBe('scripted');
  });

  test('tekrar import: versiyon artar, latestScript yenisini döner', () => {
    const { db, chapterId } = setup();
    importScript(db, chapterId, FIXTURE);
    const r2 = importScript(db, chapterId, FIXTURE);
    expect(r2.version).toBe(2);
    expect(latestScript(db, chapterId)?.version).toBe(2);
  });

  test('bozuk JSON: SyntaxError, hiçbir şey yazılmaz', () => {
    const { db, chapterId } = setup();
    expect(() => importScript(db, chapterId, '{bozuk')).toThrow(SyntaxError);
    expect(latestScript(db, chapterId)).toBeUndefined();
  });

  test('şema hatası: ZodError', () => {
    const { db, chapterId } = setup();
    expect(() => importScript(db, chapterId, JSON.stringify({ schema_version: '1.0' }))).toThrow(/segments|cast|Required/i);
  });

  test('cast dışı konuşmacı: anlaşılır hata', () => {
    const { db, chapterId } = setup();
    const bad = JSON.parse(FIXTURE);
    bad.segments[0].speaker = 'hayalet';
    expect(() => importScript(db, chapterId, JSON.stringify(bad))).toThrow(/bilinmeyen konuşmacı/);
  });
});
