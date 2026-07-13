import { expect, test } from 'vitest';
import { generateEpisode } from '../../src/core/orchestrator.js';
import { MockAdapter } from '../../src/core/tts/mock.js';
import type { VoiceoverScript } from '../../src/core/types.js';

const script: VoiceoverScript = {
  schemaVersion: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [
    { characterId: 'narrator', displayName: 'Anlatıcı', voiceId: 'mock:A' },
    { characterId: 'kaan', displayName: 'Kaan', voiceId: 'mock:B' },
  ],
  segments: [
    { id: 's1', speaker: 'narrator', type: 'narration', text: 'Kapı açıldı.', pauseAfterMs: 200 },
    { id: 's2', speaker: 'kaan', type: 'dialogue', text: 'Kim var?' },
  ],
};

test('mock adapter ile bölüm üretir', async () => {
  let progress = 0;
  const r = await generateEpisode(script, new MockAdapter(), (d) => { progress = d; });
  expect(r.segments).toHaveLength(2);
  expect(r.mp3.length).toBeGreaterThan(0);
  expect(r.totalUsd).toBeGreaterThan(0);
  expect(r.totalDurationMs).toBeGreaterThan(0);
  expect(progress).toBe(2);
}, 20000);

test('bilinmeyen konuşmacıda hata verir', async () => {
  const bad = { ...script, segments: [{ id: 's1', speaker: 'ghost', type: 'narration' as const, text: 'x' }] };
  await expect(generateEpisode(bad, new MockAdapter())).rejects.toThrow(/ghost/);
});
