import type { TtsAdapter, VoiceoverScript } from './types.js';
import { resolveVoiceForSpeaker, validateSpeakers } from './voices.js';
import { concatSegmentsToWav, wavToMp3 } from './audio/stitch.js';

export interface SegmentResult { id: string; speaker: string; durationMs: number; usd: number; }
export interface EpisodeResult { mp3: Buffer; segments: SegmentResult[]; totalUsd: number; totalDurationMs: number; }

export async function generateEpisode(
  script: VoiceoverScript,
  adapter: TtsAdapter,
  onProgress?: (done: number, total: number) => void,
): Promise<EpisodeResult> {
  validateSpeakers(script);
  const parts: { wav: Buffer; pauseAfterMs?: number }[] = [];
  const segments: SegmentResult[] = [];
  let totalUsd = 0, totalDurationMs = 0;

  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const { cast, voice } = resolveVoiceForSpeaker(script, seg.speaker);
    const style = [cast.baseStyle, seg.style].filter(Boolean).join(', ') || undefined;
    const res = await adapter.synthesize({
      text: seg.text, voice, language: script.language,
      style, tags: seg.tags, pronunciations: script.pronunciations,
    });
    parts.push({ wav: res.audio, pauseAfterMs: seg.pauseAfterMs });
    const usd = res.cost.usd ?? 0;
    segments.push({ id: seg.id, speaker: seg.speaker, durationMs: res.durationMs, usd });
    totalUsd += usd; totalDurationMs += res.durationMs;
    onProgress?.(i + 1, script.segments.length);
  }

  const wav = concatSegmentsToWav(parts);
  const mp3 = await wavToMp3(wav);
  return { mp3, segments, totalUsd, totalDurationMs };
}
