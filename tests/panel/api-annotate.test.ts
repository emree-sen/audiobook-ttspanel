import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, updateChapter } from '@/lib/services/chapters';
import { setSetting } from '@/lib/services/settings';
import * as annotateRoute from '@/app/api/chapters/[id]/annotate/route';
import * as castVoiceRoute from '@/app/api/chapters/[id]/cast-voice/route';
import * as chapterRoute from '@/app/api/chapters/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi.';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); setDbForTests(db); setSetting(db, 'llm_provider', 'mock'); });

function mkChapter(voiceMode = 'multi') {
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B' });
  updateChapter(db, c.id, { rawText: TEXT, voiceMode });
  return c.id;
}

describe('annotate SSE', () => {
  test('mock LLM ile progress + done; sonra GET cast ve usage döner', async () => {
    const id = mkChapter();
    const res = await annotateRoute.POST(jsonReq('POST', {}), ctx(id));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await new Response(res.body).text();
    expect(body).toContain('event: progress');
    expect(body).toContain('event: done');
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]);
    expect(done.castCount).toBe(2);

    const detail = await (await chapterRoute.GET(jsonReq('GET'), ctx(id))).json();
    expect(detail.script.source).toBe('llm');
    expect(detail.script.usage.chunks).toBe(1);
    expect(detail.cast.map((c: any) => c.character_id).sort()).toEqual(['kisi1', 'narrator']);
  });

  test('boş metin: SSE error olayı', async () => {
    const id = mkChapter();
    updateChapter(db, id, { rawText: '' });
    const body = await new Response((await annotateRoute.POST(jsonReq('POST', {}), ctx(id))).body).text();
    expect(body).toContain('event: error');
    expect(body).toContain('metni boş');
  });
});

describe('cast-voice', () => {
  test('ses değişir, yeni versiyon; eksik gövde 400; bilinmeyen karakter 400', async () => {
    const id = mkChapter();
    await new Response((await annotateRoute.POST(jsonReq('POST', {}), ctx(id))).body).text();

    const ok = await castVoiceRoute.POST(jsonReq('POST', { characterId: 'kisi1', voiceId: 'gemini:Puck' }), ctx(id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);

    expect((await castVoiceRoute.POST(jsonReq('POST', {}), ctx(id))).status).toBe(400);
    expect((await castVoiceRoute.POST(jsonReq('POST', { characterId: 'hayalet', voiceId: 'gemini:Puck' }), ctx(id))).status).toBe(400);
  });
});

describe('PATCH voiceMode/maxCharacters', () => {
  test('geçerli değerler kaydedilir; geçersiz voiceMode yok sayılır', async () => {
    const id = mkChapter('narrator');
    const r1 = await (await chapterRoute.PATCH(jsonReq('PATCH', { voiceMode: 'multi', maxCharacters: 3 }), ctx(id))).json();
    expect(r1.voiceMode).toBe('multi');
    expect(r1.maxCharacters).toBe(3);
    const r2 = await (await chapterRoute.PATCH(jsonReq('PATCH', { voiceMode: 'saçma' }), ctx(id))).json();
    expect(r2.voiceMode).toBe('multi'); // değişmedi
  });
});
