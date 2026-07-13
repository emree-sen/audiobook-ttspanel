import { expect, test } from 'vitest';
import { parseScript } from '../../src/core/schema.js';

const valid = {
  schema_version: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [{ character_id: 'narrator', display_name: 'Anlatıcı', voice_id: 'gemini:Charon' }],
  segments: [{ id: 's1', speaker: 'narrator', type: 'narration', text: 'Merhaba.', pause_after_ms: 200 }],
};

test('geçerli scripti camelCase tiplere çevirir', () => {
  const s = parseScript(valid);
  expect(s.schemaVersion).toBe('1.0');
  expect(s.cast[0].characterId).toBe('narrator');
  expect(s.cast[0].voiceId).toBe('gemini:Charon');
  expect(s.segments[0].pauseAfterMs).toBe(200);
});

test('eksik zorunlu alanı reddeder', () => {
  const bad = { ...valid, segments: [{ id: 's1', speaker: 'narrator', type: 'narration' }] };
  expect(() => parseScript(bad)).toThrow();
});

test('geçersiz segment type reddeder', () => {
  const bad = { ...valid, segments: [{ id: 's1', speaker: 'narrator', type: 'singing', text: 'x' }] };
  expect(() => parseScript(bad)).toThrow();
});
