export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmAnnotateRequest {
  system: string;      // sistem prompt (tarz + mod + kurallar + şema)
  user: string;        // chunk metni
  jsonSchema?: object; // structured output şeması (Dilim B'de devrede değil; arayüz hazır)
}

export interface LlmAdapter {
  readonly id: string;
  annotate(req: LlmAnnotateRequest): Promise<{ json: unknown; usage: LlmUsage }>;
}
