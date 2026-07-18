import { GoogleGenAI } from '@google/genai';
import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
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
  readonly capabilities: TtsCapabilities = { style: true };
  private ai: GoogleGenAI;
  private readonly minIntervalMs: number;
  private lastCallAt = 0;
  constructor(apiKey: string, model = 'gemini-3.1-flash-tts-preview', minIntervalMs = 6000) {
    this.model = model;
    this.id = `gemini:${model}`;
    this.minIntervalMs = minIntervalMs;
    this.ai = new GoogleGenAI({ apiKey });
  }

  // RPM rate limitine takılmamak için çağrılar arası minimum boşluk bırakır.
  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }
  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const styled = buildPrompt(req);
    // Stilli prompt bazen modeli boş yanıta itiyor (preview, non-deterministik).
    // O yüzden stilli başarısız olursa düz metne düşeriz: en azından ses üretilir.
    const prompts = styled === req.text ? [req.text] : [styled, req.text];
    let lastErr: unknown;
    for (const promptText of prompts) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.throttle();
          const response = await this.ai.models.generateContent({
            model: this.model,
            contents: [{ parts: [{ text: promptText }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice.providerVoice } } },
            },
          });
          const parts = response.candidates?.[0]?.content?.parts ?? [];
          const audioPart = parts.find((p) => p?.inlineData?.data);
          const b64 = audioPart?.inlineData?.data;
          if (!b64) {
            const finish = response.candidates?.[0]?.finishReason;
            throw new Error(`ses verisi yok (finishReason=${finish ?? 'yok'})`);
          }
          const pcm = Buffer.from(b64, 'base64');
          const usage = response.usageMetadata;
          const audioTokens = usage?.candidatesTokenCount ?? Math.round((pcm.length / 2 / 24000) * 25);
          const textTokens = usage?.promptTokenCount ?? 0;
          return {
            audio: pcmToWav(pcm), format: 'wav',
            durationMs: audioTokensToMs(audioTokens),
            cost: computeGeminiCost(textTokens, audioTokens, this.model),
          };
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }
    throw new Error(`Gemini synthesize başarısız (ses: ${req.voice.providerVoice}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}
