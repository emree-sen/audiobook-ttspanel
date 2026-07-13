import type { TtsCost } from './types.js';

const TEXT_USD_PER_TOKEN = 0.5 / 1_000_000;
const AUDIO_USD_PER_TOKEN = 10 / 1_000_000;
const AUDIO_TOKENS_PER_SECOND = 25;

export function computeGeminiCost(textTokens: number, audioTokens: number): TtsCost {
  const usd = textTokens * TEXT_USD_PER_TOKEN + audioTokens * AUDIO_USD_PER_TOKEN;
  return { unit: 'audio_tokens', amount: audioTokens, usd };
}
export function audioTokensToMs(audioTokens: number): number {
  return (audioTokens / AUDIO_TOKENS_PER_SECOND) * 1000;
}
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
