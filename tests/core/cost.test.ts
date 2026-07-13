import { expect, test } from 'vitest';
import { audioTokensToMs, computeGeminiCost, formatUsd } from '../../src/core/cost.js';

test('gemini maliyeti hesaplar', () => {
  const c = computeGeminiCost(1000, 25000); // 25000 audio token
  expect(c.unit).toBe('audio_tokens');
  expect(c.amount).toBe(25000);
  // 1000/1e6*0.5 + 25000/1e6*10 = 0.0005 + 0.25 = 0.2505
  expect(c.usd).toBeCloseTo(0.2505, 6);
});
test('audio token -> ms', () => { expect(audioTokensToMs(25)).toBe(1000); });
test('usd formatı', () => { expect(formatUsd(0.2505)).toBe('$0.2505'); });
