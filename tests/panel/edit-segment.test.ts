import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { editSegment, importScript, latestScript, listSegments } from '@/lib/services/scripts';
import { planChapter, preflightChapter } from '@/lib/services/preflight';
import { audioCache } from '@/lib/db/schema';
import * as segRoute from '@/app/api/segments/[id]/route';
import * as scriptRoute from '@/app/api/chapters/[id]/script/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let db: Db, chapterId: string, scriptId: string;
beforeEach(() => {
  db = createDb(':memory:'); setDbForTests(db);
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  chapterId = c.id;
  scriptId = importScript(db, chapterId, FIXTURE).scriptId;
});

describe('editSegment', () => {
  test('yeni versiyon; yalnız hedef segment değişir; stil null silinir', () => {
    const seg = listSegments(db, scriptId)[1];
    const out = editSegment(db, seg.id, { text: 'Yeni metin.', style: null });
    expect(out.version).toBe(2);
    const json = JSON.parse(latestScript(db, chapterId)!.json);
    expect(json.segments[1].text).toBe('Yeni metin.');
    expect(json.segments[1].style).toBeUndefined();
    expect(json.segments[0].text).toBe(JSON.parse(FIXTURE).segments[0].text);
  });
  test('boş metin, olmayan segment ve eski-versiyon segmenti Türkçe hata', () => {
    const seg = listSegments(db, scriptId)[0];
    expect(() => editSegment(db, seg.id, { text: '  ' })).toThrow(/boş olamaz/);
    expect(() => editSegment(db, 'seg_yok', { text: 'x' })).toThrow(/bulunamadı/);
    editSegment(db, seg.id, { text: 'v2 metni' }); // v2 oluştu → eski seg artık güncel değil
    expect(() => editSegment(db, seg.id, { text: 'x' })).toThrow(/güncel script/);
  });
  test('cache sözleşmesi: düzenleme yalnız hedef segmentin hash\'ini değiştirir (1 yeni çağrı)', () => {
    const { plan } = planChapter(db, chapterId);
    for (const p of plan) {
      db.insert(audioCache).values({ hash: p.hash, path: `segments/${p.hash}.wav`, durationMs: 0, usd: 0, createdAt: Date.now() }).run();
    }
    expect(preflightChapter(db, chapterId)).toMatchObject({ cached: 5, newCalls: 0 });

    editSegment(db, listSegments(db, scriptId)[1].id, { text: 'Düzenlenmiş metin.' });

    expect(preflightChapter(db, chapterId)).toMatchObject({ cached: 4, newCalls: 1 });
  });
});

describe('rotalar', () => {
  test('PATCH /api/segments/[id] → {scriptId, version}; geçersiz gövde 400', async () => {
    const seg = listSegments(db, scriptId)[0];
    const ok = await segRoute.PATCH(jsonReq('PATCH', { text: 'Düzenlendi.' }), ctx(seg.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);
    const bad = await segRoute.PATCH(jsonReq('PATCH', {}), ctx(seg.id));
    expect(bad.status).toBe(400);
  });
  test('GET /api/chapters/[id]/script → JSON metni; script yoksa 404', async () => {
    const ok = await scriptRoute.GET(jsonReq('GET'), ctx(chapterId));
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text()).segments).toHaveLength(5);
    const p2 = createProject(db, { title: 'X' });
    const c2 = createChapter(db, p2.id, { title: 'Boş' });
    expect((await scriptRoute.GET(jsonReq('GET'), ctx(c2.id))).status).toBe(404);
  });
});
