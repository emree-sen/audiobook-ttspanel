import { expect, test } from 'vitest';
import { overrideAllVoices, parseVoiceId, resolveVoiceForSpeaker, validateSpeakers } from '../../src/core/voices.js';
import type { VoiceoverScript } from '../../src/core/types.js';

const script: VoiceoverScript = {
  schemaVersion: '1.0', series: 'X', season: 1, episode: 1, title: 'T', language: 'tr-TR',
  cast: [{ characterId: 'narrator', displayName: 'Anlatıcı', voiceId: 'gemini:Charon', baseStyle: 'sakin' }],
  segments: [{ id: 's1', speaker: 'narrator', type: 'narration', text: 'x' }],
};

test('voiceId çözer', () => {
  expect(parseVoiceId('gemini:Charon')).toEqual({ provider: 'gemini', providerVoice: 'Charon' });
});
test('iki nokta yoksa hata', () => { expect(() => parseVoiceId('Charon')).toThrow(); });
test('konuşmacının sesini bulur', () => {
  const r = resolveVoiceForSpeaker(script, 'narrator');
  expect(r.voice.providerVoice).toBe('Charon');
  expect(r.cast.baseStyle).toBe('sakin');
});
test('bilinmeyen konuşmacı reddedilir', () => {
  const bad = { ...script, segments: [{ id: 's1', speaker: 'ghost', type: 'narration' as const, text: 'x' }] };
  expect(() => validateSpeakers(bad)).toThrow(/ghost/);
});
test('tüm sesleri tek sese geçirir (single narrator)', () => {
  const multi = { ...script, cast: [
    { characterId: 'narrator', displayName: 'A', voiceId: 'gemini:Charon' },
    { characterId: 'kaan', displayName: 'K', voiceId: 'gemini:Puck' },
  ] };
  const s = overrideAllVoices(multi, 'gemini:Iapetus');
  expect(s.cast.every((c) => c.voiceId === 'gemini:Iapetus')).toBe(true);
  expect(() => overrideAllVoices(multi, 'bozuk')).toThrow();
});
