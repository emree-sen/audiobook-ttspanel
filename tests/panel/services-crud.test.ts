import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { getSetting, setSetting } from '@/lib/services/settings';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '@/lib/services/projects';
import { createChapter, deleteChapter, getChapter, listChapters, updateChapter } from '@/lib/services/chapters';

describe('settings', () => {
  test('set/get + üzerine yazma', () => {
    const db = createDb(':memory:');
    expect(getSetting(db, 'provider')).toBeUndefined();
    setSetting(db, 'provider', 'mock');
    expect(getSetting(db, 'provider')).toBe('mock');
    setSetting(db, 'provider', 'gemini');
    expect(getSetting(db, 'provider')).toBe('gemini');
  });
});

describe('projects', () => {
  test('CRUD döngüsü', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'Roman' });
    expect(p.id).toMatch(/^prj_/);
    expect(listProjects(db)).toHaveLength(1);
    const u = updateProject(db, p.id, { title: 'Roman 2' });
    expect(u?.title).toBe('Roman 2');
    expect(getProject(db, p.id)?.title).toBe('Roman 2');
    deleteProject(db, p.id);
    expect(listProjects(db)).toHaveLength(0);
  });
});

describe('chapters', () => {
  test('position otomatik artar, listede sıralı gelir', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c1 = createChapter(db, p.id, { title: 'Bölüm 1' });
    const c2 = createChapter(db, p.id, { title: 'Bölüm 2' });
    expect(c1.position).toBe(1);
    expect(c2.position).toBe(2);
    expect(c1.status).toBe('draft');
    expect(listChapters(db, p.id).map((c) => c.title)).toEqual(['Bölüm 1', 'Bölüm 2']);
  });

  test('update: rawText + narrationStyle + status', () => {
    const db = createDb(':memory:');
    const p = createProject(db, { title: 'R' });
    const c = createChapter(db, p.id, { title: 'B' });
    updateChapter(db, c.id, { rawText: 'metin', narrationStyle: 'sakin', status: 'scripted' });
    const g = getChapter(db, c.id);
    expect(g?.rawText).toBe('metin');
    expect(g?.narrationStyle).toBe('sakin');
    expect(g?.status).toBe('scripted');
    deleteChapter(db, c.id);
    expect(getChapter(db, c.id)).toBeUndefined();
  });
});
