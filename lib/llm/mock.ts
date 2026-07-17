import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';

// Deterministik sahte LLM (testler + ücretsiz deneme): cümle başına segment;
// 'çok karakterli' modda tırnaklı cümleler "kisi1" diyaloğu olur. Ağ yok.
export class MockLlmAdapter implements LlmAdapter {
  readonly id = 'mock-llm';
  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    const multi = req.system.includes('çok karakterli');
    const sentences = req.user.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    let hasDialogue = false;
    const segments = sentences.map((text) => {
      const dialogue = multi && /["""«]/.test(text);
      if (dialogue) hasDialogue = true;
      return { speaker: dialogue ? 'kisi1' : 'narrator', type: dialogue ? 'dialogue' : 'narration', text };
    });
    const cast = [{ character_id: 'narrator', display_name: 'Anlatıcı', gender: 'unknown', age_hint: 'adult', persona: 'anlatıcı' }];
    if (hasDialogue) cast.push({ character_id: 'kisi1', display_name: 'Kişi 1', gender: 'male', age_hint: 'young', persona: 'genç erkek' });
    return { json: { cast, segments, pronunciations: [] }, usage: { inputTokens: Math.ceil(req.user.length / 4), outputTokens: 100 } };
  }
}
