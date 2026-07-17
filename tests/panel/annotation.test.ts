import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter, updateChapter } from '@/lib/services/chapters';
import { latestScript, listSegments } from '@/lib/services/scripts';
import { setSetting } from '@/lib/services/settings';
import { annotateChapter, chunkText, llmAdapterFromSettings } from '@/lib/services/annotation';
import { MockLlmAdapter } from '@/lib/llm/mock';
import type { LlmAdapter } from '@/lib/llm/types';

const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi.\n\nElara gölgeden çıktı. "Sakin ol, çocuk."';

function setup(voiceMode: 'narrator' | 'multi' = 'narrator') {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  updateChapter(db, c.id, { rawText: TEXT, narrationStyle: 'gizemli', voiceMode });
  return { db, chapterId: c.id };
}

describe('chunkText', () => {
  test('kısa metin tek parça; boş metin Türkçe hata', () => {
    expect(chunkText('merhaba dünya')).toEqual(['merhaba dünya']);
    expect(() => chunkText('   ')).toThrow(/metni boş/);
  });
  test('uzun metin paragraf sınırından bölünür', () => {
    const para = 'a'.repeat(4000);
    const chunks = chunkText([para, para, para, para].join('\n\n'), 10000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(`${para}\n\n${para}`);
  });
});

describe('annotateChapter (MockLlmAdapter)', () => {
  test('narrator modu: script yazılır, tüm speaker narrator, tek cast, source=llm', async () => {
    const { db, chapterId } = setup('narrator');
    const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(out.version).toBe(1);
    expect(out.castCount).toBe(1);
    expect(out.usage.chunks).toBe(1);
    const scr = latestScript(db, chapterId)!;
    expect(scr.source).toBe('llm');
    expect(JSON.parse(scr.usageJson!)).toMatchObject({ chunks: 1 });
    const json = JSON.parse(scr.json);
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({ character_id: 'narrator', voice_id: 'gemini:Charon', base_style: 'gizemli' });
    expect(json.segments.every((s: any) => s.speaker === 'narrator')).toBe(true);
    expect(json.segments[0].id).toBe('s1');
    expect(listSegments(db, scr.id).length).toBe(json.segments.length);
    expect(getChapter(db, chapterId)?.status).toBe('scripted');
  });

  test('multi modu: kisi1 cast\'e girer, cinsiyete uygun ses atanır (Charon hariç)', async () => {
    const { db, chapterId } = setup('multi');
    const out = await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(out.castCount).toBe(2);
    const json = JSON.parse(latestScript(db, chapterId)!.json);
    const kisi1 = json.cast.find((c: any) => c.character_id === 'kisi1');
    expect(kisi1.voice_id).toMatch(/^gemini:/);
    expect(kisi1.voice_id).not.toBe('gemini:Charon'); // anlatıcının sesi kullanılmış sayılır
    expect(kisi1.base_style).toBe('genç erkek');
    expect(json.segments.some((s: any) => s.speaker === 'kisi1')).toBe(true);
  });

  test('default_voice ayarı anlatıcı sesini değiştirir', async () => {
    const { db, chapterId } = setup('narrator');
    setSetting(db, 'default_voice', 'gemini:Iapetus');
    await annotateChapter(db, chapterId, new MockLlmAdapter());
    expect(JSON.parse(latestScript(db, chapterId)!.json).cast[0].voice_id).toBe('gemini:Iapetus');
  });

  test('bozuk ilk yanıt → retry ile düzelir; retry\'da hata özeti prompt\'a eklenir', async () => {
    const { db, chapterId } = setup('narrator');
    let call = 0;
    const systems: string[] = [];
    const inner = new MockLlmAdapter();
    const flaky: LlmAdapter = {
      id: 'flaky',
      annotate(req) {
        systems.push(req.system);
        if (++call === 1) return Promise.resolve({ json: { bozuk: true }, usage: { inputTokens: 1, outputTokens: 1 } });
        return inner.annotate(req);
      },
    };
    const out = await annotateChapter(db, chapterId, flaky);
    expect(out.version).toBe(1);
    expect(call).toBe(2);
    expect(systems[1]).toContain('ÖNCEKİ DENEMENİN HATASI');
  });

  test('iki deneme de bozuksa Türkçe hata, script yazılmaz', async () => {
    const { db, chapterId } = setup('narrator');
    const broken: LlmAdapter = { id: 'broken', annotate: () => Promise.resolve({ json: { bozuk: true }, usage: { inputTokens: 1, outputTokens: 1 } }) };
    await expect(annotateChapter(db, chapterId, broken)).rejects.toThrow(/doğrulanamadı/);
    expect(latestScript(db, chapterId)).toBeUndefined();
  });

  test('cast dışı speaker narrator\'a düşürülür (dayanıklılık)', async () => {
    const { db, chapterId } = setup('multi');
    const weird: LlmAdapter = {
      id: 'weird',
      annotate: () => Promise.resolve({
        json: {
          cast: [{ character_id: 'narrator', display_name: 'Anlatıcı', gender: 'unknown', age_hint: 'adult' }],
          segments: [{ speaker: 'hayalet', type: 'dialogue', text: 'buu' }],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    await annotateChapter(db, chapterId, weird);
    expect(JSON.parse(latestScript(db, chapterId)!.json).segments[0].speaker).toBe('narrator');
  });

  test('instruction: sistem prompt\'a düzeltme + önceki özet girer, versiyon artar', async () => {
    const { db, chapterId } = setup('narrator');
    await annotateChapter(db, chapterId, new MockLlmAdapter());
    const systems: string[] = [];
    const spy: LlmAdapter = { id: 'spy', annotate(req) { systems.push(req.system); return new MockLlmAdapter().annotate(req); } };
    const out = await annotateChapter(db, chapterId, spy, { instruction: 'daha az segment' });
    expect(out.version).toBe(2);
    expect(systems[0]).toContain('KULLANICI DÜZELTMESİ');
    expect(systems[0]).toContain('ÖNCEKİ DENEME ÖZETİ: v1:');
  });

  test('onProgress chunk ilerlemesini bildirir', async () => {
    const { db, chapterId } = setup('narrator');
    const progress: [number, number][] = [];
    await annotateChapter(db, chapterId, new MockLlmAdapter(), { onProgress: (d, t) => progress.push([d, t]) });
    expect(progress).toEqual([[1, 1]]);
  });
});

describe('llmAdapterFromSettings', () => {
  test('llm_provider=mock MockLlmAdapter döner; gemini + anahtarsız Türkçe hata', () => {
    const db = createDb(':memory:');
    setSetting(db, 'llm_provider', 'mock');
    expect(llmAdapterFromSettings(db).id).toBe('mock-llm');
    setSetting(db, 'llm_provider', 'gemini');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try { expect(() => llmAdapterFromSettings(db)).toThrow(/GEMINI_API_KEY/); }
    finally { if (saved) process.env.GEMINI_API_KEY = saved; }
  });
});
