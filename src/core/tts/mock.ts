import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
import { makeSilencePcm, pcmToWav } from '../audio/wav.js';
import { computeGeminiCost } from '../cost.js';

const MS_PER_CHAR = 50;

export class MockAdapter implements TtsAdapter {
  readonly id = 'mock';
  readonly capabilities: TtsCapabilities = { style: true };
  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const durationMs = req.text.length * MS_PER_CHAR;
    const pcm = makeSilencePcm(durationMs);
    const audioTokens = Math.round((durationMs / 1000) * 25);
    return { audio: pcmToWav(pcm), format: 'wav', durationMs, cost: computeGeminiCost(0, audioTokens) };
  }
}
