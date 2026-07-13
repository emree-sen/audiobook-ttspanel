import { z } from 'zod';
import type { VoiceoverScript } from './types.js';

const castSchema = z.object({
  character_id: z.string().min(1),
  display_name: z.string().min(1),
  voice_id: z.string().min(1),
  base_style: z.string().optional(),
}).transform((c) => ({ characterId: c.character_id, displayName: c.display_name, voiceId: c.voice_id, baseStyle: c.base_style }));

const segmentSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  type: z.enum(['narration', 'dialogue', 'thought']),
  text: z.string().min(1),
  style: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pause_after_ms: z.number().int().nonnegative().optional(),
}).transform((s) => ({ id: s.id, speaker: s.speaker, type: s.type, text: s.text, style: s.style, tags: s.tags, pauseAfterMs: s.pause_after_ms }));

const pronSchema = z.object({ term: z.string(), say_as: z.string() })
  .transform((p) => ({ term: p.term, sayAs: p.say_as }));

const scriptSchema = z.object({
  schema_version: z.string(),
  series: z.string(), season: z.number().int(), episode: z.number().int(),
  title: z.string(), language: z.string(),
  cast: z.array(castSchema).min(1),
  segments: z.array(segmentSchema).min(1),
  pronunciations: z.array(pronSchema).optional(),
}).transform((s) => ({
  schemaVersion: s.schema_version, series: s.series, season: s.season, episode: s.episode,
  title: s.title, language: s.language, cast: s.cast, segments: s.segments, pronunciations: s.pronunciations,
}));

export function parseScript(json: unknown): VoiceoverScript {
  return scriptSchema.parse(json) as VoiceoverScript;
}
