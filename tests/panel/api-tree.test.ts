import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import * as treeRoute from '@/app/api/tree/route';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); });

describe('GET /api/tree', () => {
  test('boş durumda boş dizi', async () => {
    expect(await (await treeRoute.GET()).json()).toEqual([]);
  });

  test('projeler + bölümleri sıralı döner', async () => {
    const p1 = createProject(db, { title: 'Roman' });
    const _p2 = createProject(db, { title: 'Deneme' });
    createChapter(db, p1.id, { title: 'B1' });
    createChapter(db, p1.id, { title: 'B2' });
    const tree = await (await treeRoute.GET()).json();
    expect(tree).toHaveLength(2);
    expect(tree[0].project.title).toBe('Roman');
    expect(tree[0].chapters.map((c: any) => c.title)).toEqual(['B1', 'B2']);
    expect(tree[1].chapters).toEqual([]);
    expect(tree[0].chapters[0]).toMatchObject({ position: 1, status: 'draft' });
  });
});
