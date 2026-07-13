import type { TtsCost } from './types.js';

interface Rate { text: number; audio: number } // USD per token

// Gemini native TTS fiyatları (mid-2026); araştırma: docs/research/2026-07-13-tts-provider-research.md §4
const PRICING: Record<string, Rate> = {
  'gemini-2.5-flash-preview-tts': { text: 0.5 / 1_000_000, audio: 10 / 1_000_000 },
  'gemini-2.5-pro-preview-tts': { text: 1 / 1_000_000, audio: 20 / 1_000_000 },
  'gemini-3.1-flash-tts-preview': { text: 1 / 1_000_000, audio: 20 / 1_000_000 },
};
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const AUDIO_TOKENS_PER_SECOND = 25;

export function computeGeminiCost(textTokens: number, audioTokens: number, model?: string): TtsCost {
  const rate = (model && PRICING[model]) || PRICING[DEFAULT_MODEL];
  const usd = textTokens * rate.text + audioTokens * rate.audio;
  return { unit: 'audio_tokens', amount: audioTokens, usd };
}
export function audioTokensToMs(audioTokens: number): number {
  return (audioTokens / AUDIO_TOKENS_PER_SECOND) * 1000;
}
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
