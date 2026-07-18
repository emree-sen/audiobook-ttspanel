import { describe, expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav } from '@/src/core/audio/wav';
import { wavDurationMs } from '@/src/core/audio/wav-info';

describe('wavDurationMs', () => {
  test('44 baytlık standart başlıktan süreyi okur', () => {
    expect(wavDurationMs(pcmToWav(makeSilencePcm(500)))).toBe(500);
    expect(wavDurationMs(pcmToWav(makeSilencePcm(1234)))).toBe(1234);
  });
  test('RIFF olmayan veya kısa buffer → 0', () => {
    expect(wavDurationMs(Buffer.from('bu bir wav değil'))).toBe(0);
    expect(wavDurationMs(Buffer.alloc(4))).toBe(0);
  });
});
