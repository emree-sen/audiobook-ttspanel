import { expect, test } from 'vitest';
import { MockAdapter } from '../../src/core/tts/mock.js';
import { wavToPcm } from '../../src/core/audio/wav.js';

test('mock adapter metinle orantılı WAV üretir', async () => {
  const a = new MockAdapter();
  const r = await a.synthesize({ text: 'abcdefghij', voice: { provider: 'mock', providerVoice: 'x' }, language: 'tr-TR' });
  expect(a.id).toBe('mock');
  expect(r.format).toBe('wav');
  expect(r.durationMs).toBe(10 * 50); // 10 karakter * 50ms
  // 500ms @ 24000Hz*2byte = 24000 byte PCM
  expect(wavToPcm(r.audio).length).toBe(Math.round(24000 * 2 * 0.5));
  expect(r.cost.usd).toBeGreaterThan(0);
});
