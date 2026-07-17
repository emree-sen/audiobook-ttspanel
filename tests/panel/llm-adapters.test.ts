import { describe, expect, test } from 'vitest';
import { MockLlmAdapter } from '@/lib/llm/mock';
import { GeminiLlmAdapter } from '@/lib/llm/gemini';
import { llmChunkSchema } from '@/lib/llm/schema';
import { buildSystemPrompt } from '@/lib/llm/prompt';

const TEXT = 'Zindan kapısı gıcırdadı. "Kim var orada?" Kaan geriledi. Elara gülümsedi.';

describe('MockLlmAdapter', () => {
  test('narrator modu: tüm segmentler narrator, şemaya uygun', async () => {
    const r = await new MockLlmAdapter().annotate({ system: buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 }), user: TEXT });
    const chunk = llmChunkSchema.parse(r.json);
    expect(chunk.segments.length).toBeGreaterThanOrEqual(3);
    expect(chunk.segments.every((s) => s.speaker === 'narrator')).toBe(true);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  test('multi modu: tırnaklı cümle kisi1 diyaloğu, cast 2 kişi', async () => {
    const r = await new MockLlmAdapter().annotate({ system: buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 }), user: TEXT });
    const chunk = llmChunkSchema.parse(r.json);
    expect(chunk.segments.some((s) => s.speaker === 'kisi1' && s.type === 'dialogue')).toBe(true);
    expect(chunk.cast.map((c) => c.character_id).sort()).toEqual(['kisi1', 'narrator']);
  });

  test('deterministik: aynı girdi aynı çıktı', async () => {
    const m = new MockLlmAdapter();
    const req = { system: buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 }), user: TEXT };
    expect(await m.annotate(req)).toEqual(await m.annotate(req));
  });

  test('multi modu kıvrık tırnaklar: kıvrık tırnaklı cümle kisi1 diyaloğu', async () => {
    const textWithCurlyQuotes = 'Kapı açıldı. “Kim var orada?” diye bağırdı.';
    const r = await new MockLlmAdapter().annotate({ system: buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 }), user: textWithCurlyQuotes });
    const chunk = llmChunkSchema.parse(r.json);
    expect(chunk.segments.some((s) => s.speaker === 'kisi1' && s.type === 'dialogue')).toBe(true);
    expect(chunk.cast.map((c) => c.character_id).sort()).toEqual(['kisi1', 'narrator']);
  });
});

describe('GeminiLlmAdapter (ağ yok, kurulum)', () => {
  test('id ve model varsayılanı', () => {
    const a = new GeminiLlmAdapter('anahtar');
    expect(a.model).toBe('gemini-2.5-flash');
    expect(a.id).toBe('gemini-llm:gemini-2.5-flash');
    expect(new GeminiLlmAdapter('anahtar', 'baska-model').id).toBe('gemini-llm:baska-model');
  });
});
