import { GoogleGenAI } from '@google/genai';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '../types.js';
import { pcmToWav } from '../audio/wav.js';
import { audioTokensToMs, computeGeminiCost } from '../cost.js';

export function buildPrompt(req: TtsSegmentRequest): string {
  const directives: string[] = [];
  if (req.style) directives.push(`Style: ${req.style}`);
  if (req.tags?.length) directives.push(req.tags.join(' '));
  if (req.pronunciations?.length) {
    directives.push('Pronounce: ' + req.pronunciations.map((p) => `${p.term} as ${p.sayAs}`).join('; '));
  }
  if (directives.length === 0) return req.text;
  return `${directives.join('. ')}.\n${req.text}`;
}

export class GeminiAdapter implements TtsAdapter {
  readonly id: string;
  readonly model: string;
  private ai: GoogleGenAI;
  constructor(apiKey: string, model = 'gemini-3.1-flash-tts-preview') {
    this.model = model;
    this.id = `gemini:${model}`;
    this.ai = new GoogleGenAI({ apiKey });
  }
  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const prompt = buildPrompt(req);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice.providerVoice } } },
      },
    });
    const part = response.candidates?.[0]?.content?.parts?.[0];
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error('Gemini yanıtında ses verisi yok');
    const pcm = Buffer.from(b64, 'base64');
    const usage = response.usageMetadata;
    const audioTokens = usage?.candidatesTokenCount ?? Math.round((pcm.length / 2 / 24000) * 25);
    const textTokens = usage?.promptTokenCount ?? 0;
    return {
      audio: pcmToWav(pcm), format: 'wav',
      durationMs: audioTokensToMs(audioTokens),
      cost: computeGeminiCost(textTokens, audioTokens, this.model),
    };
  }
}
