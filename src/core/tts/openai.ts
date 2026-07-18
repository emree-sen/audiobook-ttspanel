import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
import { wavDurationMs } from '../audio/wav-info.js';

export interface OpenAiCompatConfig { id: string; baseUrl: string; apiKey?: string | null; model: string }

// OpenAI-uyumlu /audio/speech endpoint'i (OpenAI, AllTalk, openedai-speech, LocalAI...).
// baseUrl "/v1" dahil girilir (ör. http://localhost:8000/v1). Retry yok: lokal sunucular
// hızlı-başarısız; Gemini'deki retry oradaki preview kırılganlığına özeldi.
export class OpenAiCompatAdapter implements TtsAdapter {
  readonly id: string;
  readonly capabilities: TtsCapabilities = { style: false };
  constructor(private readonly cfg: OpenAiCompatConfig) { this.id = cfg.id; }

  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model: this.cfg.model, voice: req.voice.providerVoice, input: req.text, response_format: 'wav' }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`TTS sunucusu hata döndürdü (HTTP ${res.status}): ${body || 'gövde yok'}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, format: 'wav', durationMs: wavDurationMs(audio), cost: { unit: 'chars', amount: req.text.length, usd: 0 } };
  }
}
