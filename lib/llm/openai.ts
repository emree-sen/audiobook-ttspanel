import type { LlmAdapter, LlmAnnotateRequest, LlmUsage } from './types';
import { extractJson } from './schema';

// <think>…</think> (lokal reasoning modelleri sızdırır) ve ```json çitlerini sıyırır.
export function stripLlmWrappers(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  t = t.replace(/<think>[\s\S]*$/, ''); // kapanmamış <think>: kesilmiş yanıt, sonuna kadar at
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  return t.trim();
}

export interface OpenAiCompatLlmConfig { baseUrl: string; apiKey?: string | null; model: string }

// OpenAI-uyumlu /chat/completions (LM Studio, Ollama, OpenRouter, Groq…).
// baseUrl "/v1" dahil girilir. Şema doğrulama + retry annotateChunk'ta; adapter şema bilmez.
export class OpenAiCompatLlmAdapter implements LlmAdapter {
  readonly id: string;
  constructor(private readonly cfg: OpenAiCompatLlmConfig) { this.id = `openai-llm:${cfg.model}`; }

  async annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }> {
    // json_object bazı sunucularda desteklenmez: 4xx dönerse alansız bir deneme daha.
    let res = await this.postChecked(req, true);
    if (!res.ok && res.status >= 400 && res.status < 500) res = await this.postChecked(req, false);
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`LLM sunucusu hata döndürdü (HTTP ${res.status}): ${body || 'gövde yok'}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error('LLM yanıtı JSON olarak çözümlenemedi');
    }
    const content: string = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('LLM yanıtı boş (choices[0].message.content yok)');
    const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    return {
      json: extractJson(stripLlmWrappers(content)),
      usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 },
    };
  }

  // fetch ağ seviyesinde reddedebilir (sunucu ayakta değil, DNS vb.); okunur Türkçe mesaja çevir.
  private async postChecked(req: LlmAnnotateRequest, jsonMode: boolean): Promise<Response> {
    try {
      return await this.post(req, jsonMode);
    } catch {
      throw new Error(`LLM sunucusuna bağlanılamadı (${this.cfg.baseUrl}) — sunucunun çalıştığından emin olun`);
    }
  }

  private post(req: LlmAnnotateRequest, jsonMode: boolean): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    return fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  }
}
