// Hızlı kurulum kartının saf durum türetimi — GET /api/settings yanıtından hesaplanır.
export interface SetupInput {
  provider: string; llmProvider: string; llmBaseUrl: string; llmModel: string;
  piperExe: string; geminiKeySource: 'db' | 'env' | null;
  connections: { id: string }[]; voices: Record<string, { id: string }[]>;
}
export interface SetupStatus { llm: boolean; tts: boolean; pool: boolean }

export function setupStatus(d: SetupInput): SetupStatus {
  const llm = d.llmProvider === 'mock'
    || (d.llmProvider === 'gemini' && d.geminiKeySource !== null)
    || (d.llmProvider === 'openai-compat' && !!d.llmBaseUrl && !!d.llmModel);
  const tts = d.provider === 'mock'
    || (d.provider === 'gemini' && d.geminiKeySource !== null)
    || (d.provider === 'piper' && !!d.piperExe)
    || d.connections.some((c) => c.id === d.provider);
  const pool = d.provider === 'mock' || (d.voices[d.provider] ?? []).length > 0;
  return { llm, tts, pool };
}
