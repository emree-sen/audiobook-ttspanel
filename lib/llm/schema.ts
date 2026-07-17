import { z } from 'zod';

// LLM chunk çıktısı: cast TİPLİ ama voice_id'SİZ (sesi sistem atar), segment id'siz (sistem numaralar).
export const llmCastSchema = z.object({
  character_id: z.string().min(1),
  display_name: z.string().min(1),
  gender: z.enum(['male', 'female', 'unknown']).catch('unknown'),
  age_hint: z.enum(['child', 'young', 'adult', 'elder']).catch('adult'),
  persona: z.string().optional(),
});

export const llmSegmentSchema = z.object({
  speaker: z.string().min(1),
  type: z.enum(['narration', 'dialogue', 'thought']).catch('narration'),
  text: z.string().min(1),
  style: z.string().optional(),
  pause_after_ms: z.number().int().nonnegative().optional(),
});

export const llmChunkSchema = z.object({
  cast: z.array(llmCastSchema).default([]),
  segments: z.array(llmSegmentSchema).min(1),
  pronunciations: z.array(z.object({ term: z.string().min(1), say_as: z.string().min(1) })).default([]),
});

export type LlmCast = z.infer<typeof llmCastSchema>;
export type LlmChunk = z.infer<typeof llmChunkSchema>;

// LLM yanıtından JSON çıkar: önce doğrudan parse, sonra ilk {...} bloğu.
export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fallback aşağıda
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('LLM yanıtında JSON bulunamadı');
  return JSON.parse(m[0]);
}
