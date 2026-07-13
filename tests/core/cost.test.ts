import { expect, test } from 'vitest';
import { audioTokensToMs, computeGeminiCost, formatUsd } from '../../src/core/cost.js';

test('gemini maliyeti hesaplar', () => {
  const c = computeGeminiCost(1000, 25000); // 25000 audio token
  expect(c.unit).toBe('audio_tokens');
  expect(c.amount).toBe(25000);
  // 1000/1e6*0.5 + 25000/1e6*10 = 0.0005 + 0.25 = 0.2505
  expect(c.usd).toBeCloseTo(0.2505, 6);
});
test('3.1 flash 2x fiyatı uygular', () => {
  const c = computeGeminiCost(1000, 25000, 'gemini-3.1-flash-tts-preview');
  // 1000/1e6*1 + 25000/1e6*20 = 0.001 + 0.5 = 0.501
  expect(c.usd).toBeCloseTo(0.501, 6);
});
test('audio token -> ms', () => { expect(audioTokensToMs(25)).toBe(1000); });
test('usd formatı', () => { expect(formatUsd(0.2505)).toBe('$0.2505'); });
