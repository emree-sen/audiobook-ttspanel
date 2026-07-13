import { expect, test } from 'vitest';
import { concatSegmentsToWav, wavToMp3 } from '../../src/core/audio/stitch.js';
import { makeSilencePcm, pcmToWav, wavToPcm } from '../../src/core/audio/wav.js';

test('segmentleri sessizlikle birleştirir', () => {
  const a = pcmToWav(makeSilencePcm(500)); // 0.5sn
  const b = pcmToWav(makeSilencePcm(500));
  const out = concatSegmentsToWav([{ wav: a, pauseAfterMs: 1000 }, { wav: b }]);
  // 0.5 + 1.0 (pause) + 0.5 = 2.0 sn PCM = 24000*2*2 byte
  expect(wavToPcm(out).length).toBe(24000 * 2 * 2);
});

test('wav -> mp3 kodlar', async () => {
  const wav = pcmToWav(makeSilencePcm(300));
  const mp3 = await wavToMp3(wav);
  expect(mp3.length).toBeGreaterThan(0);
  // mp3 çerçevesi 0xFF ile başlar (ID3 yoksa) — en azından boş değil ve wav değil
  expect(mp3.toString('ascii', 0, 4)).not.toBe('RIFF');
}, 20000);
