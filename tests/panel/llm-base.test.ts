import { describe, expect, test } from 'vitest';
import { extractJson, llmChunkSchema } from '@/lib/llm/schema';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/llm/prompt';

describe('extractJson', () => {
  test('düz JSON parse', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  test('metin içinden ilk {...} bloğu', () => expect(extractJson('İşte JSON:\n```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  test('JSON yoksa Türkçe hata', () => expect(() => extractJson('json yok')).toThrow(/JSON bulunamadı/));
});

describe('llmChunkSchema', () => {
  test('geçerli chunk parse olur, bilinmeyen enum tolere edilir (catch)', () => {
    const r = llmChunkSchema.parse({
      cast: [{ character_id: 'k', display_name: 'K', gender: 'robot', age_hint: 'baby' }],
      segments: [{ speaker: 'k', type: 'şarkı', text: 'merhaba' }],
    });
    expect(r.cast[0].gender).toBe('unknown');
    expect(r.cast[0].age_hint).toBe('adult');
    expect(r.segments[0].type).toBe('narration');
    expect(r.pronunciations).toEqual([]);
  });
  test('boş segments reddedilir', () => {
    expect(() => llmChunkSchema.parse({ cast: [], segments: [] })).toThrow();
  });
});

describe('buildSystemPrompt', () => {
  test('narrator modu işareti + kurallar', () => {
    const s = buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 });
    expect(s).toContain('tek anlatıcı');
    expect(s).toContain('"narrator"');
    expect(s).toContain('ÇIKTI ŞEMASI');
  });
  test('multi modu işareti + maks karakter + tarz + talimat + önceki cast', () => {
    const s = buildSystemPrompt({
      voiceMode: 'multi', maxCharacters: 4, narrationStyle: 'gizemli',
      knownCast: [{ character_id: 'kaan', display_name: 'Kaan', gender: 'male', age_hint: 'young' }],
      instruction: 'daha az segment', prevSummary: 'v1: 10 segment',
    });
    expect(s).toContain('çok karakterli');
    expect(s).toContain('EN FAZLA 4');
    expect(s).toContain('ANLATIM TARZI: gizemli');
    expect(s).toContain('BİLİNEN KARAKTERLER');
    expect(s).toContain('KULLANICI DÜZELTMESİ');
    expect(s).toContain('ÖNCEKİ DENEME ÖZETİ: v1: 10 segment');
  });
  test('narrator modunda paragraf-bazlı segment kuralı + kişi taklidi yasağı; 1-3 cümle kuralı YOK', () => {
    const p = buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 });
    expect(p).toContain('tek anlatıcı'); // mock marker korunur
    expect(p).toContain('paragraf bazlı, 3-6 cümle');
    expect(p).toContain('kişi taklidi tarifleri');
    expect(p).not.toContain('1-3 cümle');
  });
  test('multi modunda 1-3 cümle kuralı durur', () => {
    const p = buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 });
    expect(p).toContain('çok karakterli'); // mock marker korunur
    expect(p).toContain('1-3 cümle');
  });
});

describe('buildUserPrompt', () => {
  test('tek parça: metnin kendisi; çok parça: başlıklı', () => {
    expect(buildUserPrompt('metin', 0, 1)).toBe('metin');
    expect(buildUserPrompt('metin', 1, 3)).toContain('PARÇASI 2/3');
  });
});
