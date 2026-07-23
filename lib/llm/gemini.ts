import { GoogleGenAI } from '@google/genai';
import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';
import { extractJson } from './schema';

export class GeminiLlmAdapter implements LlmAdapter {
  readonly id: string;
  readonly model: string;
  private ai: GoogleGenAI;
  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.model = model;
    this.id = `gemini-llm:${model}`;
    this.ai = new GoogleGenAI({ apiKey });
  }

  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: [{ parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            ...(req.jsonSchema ? { responseSchema: req.jsonSchema } : {}),
          },
        });
        const text = response.text ?? response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        if (!text) throw new Error(`empty response from Gemini (finishReason=${response.candidates?.[0]?.finishReason ?? 'none'})`);
        const u = response.usageMetadata;
        return { json: extractJson(text), usage: { inputTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0 } };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw new Error(`Gemini LLM call failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}
