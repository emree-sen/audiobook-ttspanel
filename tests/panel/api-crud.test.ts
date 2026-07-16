import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests } from '@/lib/db/client';
import * as projectsRoute from '@/app/api/projects/route';
import * as projectRoute from '@/app/api/projects/[id]/route';
import * as projChaptersRoute from '@/app/api/projects/[id]/chapters/route';
import * as chapterRoute from '@/app/api/chapters/[id]/route';
import * as scriptRoute from '@/app/api/chapters/[id]/script/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => setDbForTests(createDb(':memory:')));

describe('API CRUD', () => {
  test('proje oluştur/listele/güncelle/sil', async () => {
    const created = await (await projectsRoute.POST(jsonReq('POST', { title: 'Roman' }))).json();
    expect(created.id).toMatch(/^prj_/);

    const list = await (await projectsRoute.GET()).json();
    expect(list).toHaveLength(1);

    const patched = await (await projectRoute.PATCH(jsonReq('PATCH', { title: 'R2' }), ctx(created.id))).json();
    expect(patched.title).toBe('R2');

    const del = await projectRoute.DELETE(jsonReq('DELETE'), ctx(created.id));
    expect(del.status).toBe(204);
  });

  test('title eksikse 400', async () => {
    const res = await projectsRoute.POST(jsonReq('POST', {}));
    expect(res.status).toBe(400);
  });

  test('bölüm oluştur + kompozit GET + script import', async () => {
    const p = await (await projectsRoute.POST(jsonReq('POST', { title: 'R' }))).json();
    const c = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B1' }), ctx(p.id))).json();
    expect(c.position).toBe(1);

    // proje detayı bölümleri içerir
    const pd = await (await projectRoute.GET(jsonReq('GET'), ctx(p.id))).json();
    expect(pd.chapters).toHaveLength(1);

    // script import
    const put = await scriptRoute.PUT(new Request('http://p', { method: 'PUT', body: FIXTURE }), ctx(c.id));
    expect(put.status).toBe(200);
    expect((await put.json()).segmentCount).toBe(5);

    // kompozit bölüm GET
    const cd = await (await chapterRoute.GET(jsonReq('GET'), ctx(c.id))).json();
    expect(cd.chapter.status).toBe('scripted');
    expect(cd.script.version).toBe(1);
    expect(cd.segments).toHaveLength(5);
    expect(cd.renders).toEqual([]);
  });

  test('bölüm PATCH position günceller (sıralama)', async () => {
    const p = await (await projectsRoute.POST(jsonReq('POST', { title: 'R' }))).json();
    const c1 = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B1' }), ctx(p.id))).json();
    const c2 = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B2' }), ctx(p.id))).json();
    expect(c1.position).toBe(1);
    expect(c2.position).toBe(2);

    // sırayı takas et (c1 -> 2, c2 -> 1)
    await chapterRoute.PATCH(jsonReq('PATCH', { position: c2.position }), ctx(c1.id));
    await chapterRoute.PATCH(jsonReq('PATCH', { position: c1.position }), ctx(c2.id));

    const pd = await (await projectRoute.GET(jsonReq('GET'), ctx(p.id))).json();
    expect(pd.chapters.map((c: { id: string; position: number }) => c.id)).toEqual([c2.id, c1.id]);
    expect(pd.chapters[0].position).toBe(1);
    expect(pd.chapters[1].position).toBe(2);
  });

  test('geçersiz script 400 + Türkçe hata', async () => {
    const p = await (await projectsRoute.POST(jsonReq('POST', { title: 'R' }))).json();
    const c = await (await projChaptersRoute.POST(jsonReq('POST', { title: 'B' }), ctx(p.id))).json();
    const res = await scriptRoute.PUT(new Request('http://p', { method: 'PUT', body: '{bozuk' }), ctx(c.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });

  test('olmayan kaynak 404', async () => {
    expect((await projectRoute.GET(jsonReq('GET'), ctx('prj_yok'))).status).toBe(404);
    expect((await chapterRoute.GET(jsonReq('GET'), ctx('chp_yok'))).status).toBe(404);
  });
});
