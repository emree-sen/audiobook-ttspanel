import { expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav, wavToPcm } from '../../src/core/audio/wav.js';

test('pcm -> wav -> pcm round trip', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const wav = pcmToWav(pcm);
  expect(wav.length).toBe(44 + pcm.length);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wavToPcm(wav).equals(pcm)).toBe(true);
});

test('1sn sessizlik = 24000*2 byte', () => {
  const s = makeSilencePcm(1000);
  expect(s.length).toBe(24000 * 2); // 24000 örnek * 16-bit(2 byte) * mono
  expect(s.every((b) => b === 0)).toBe(true);
});
