import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders } from '../db/schema';
import { t, type Lang } from '../i18n';
import { getSetting } from './settings';
import { activeProvider } from './quota';
import { getConnection } from './connections';
import { listVoices } from './voices';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import { OpenAiCompatAdapter } from '@/src/core/tts/openai';
import { PiperAdapter } from '@/src/core/tts/piper';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;

// Gemini anahtarı: ayarlar (DB) → env. TTS ve LLM aynı anahtarı paylaşır.
export function geminiApiKey(db: Db): string | undefined {
  return getSetting(db, 'gemini_api_key') ?? process.env.GEMINI_API_KEY ?? undefined;
}

// Stil desteği sağlayıcı ADINDAN belirlenir (adapter kurmadan — preflight anahtarsız da çalışmalı).
export function supportsStyle(provider: string): boolean {
  return provider === 'gemini' || provider === 'mock';
}

// Ayarlar (settings) → env → varsayılan sırasıyla aktif sağlayıcının adapter'ını kurar.
export function adapterFromSettings(db: Db, lang: Lang = 'tr'): TtsAdapter {
  const { name: provider, model } = activeProvider(db);
  if (provider === 'mock') return new MockAdapter();
  if (provider === 'gemini') {
    const key = geminiApiKey(db);
    if (!key) throw new Error(t(lang, 'error.geminiKeyMissing'));
    return new GeminiAdapter(key, model || undefined);
  }
  if (provider === 'piper') {
    const exe = getSetting(db, 'piper_exe');
    if (!exe) throw new Error(t(lang, 'error.piperExeMissing'));
    const models: Record<string, string> = {};
    for (const v of listVoices(db, 'piper')) if (v.path) models[v.voice] = v.path;
    if (Object.keys(models).length === 0) throw new Error(t(lang, 'error.piperNoVoiceModel'));
    return new PiperAdapter({ exePath: exe, models });
  }
  const conn = getConnection(db, provider);
  if (!conn) throw new Error(t(lang, 'error.unknownTtsProvider', { provider }));
  return new OpenAiCompatAdapter({ id: conn.id, baseUrl: conn.baseUrl, apiKey: conn.apiKey, model: conn.model });
}

export function listRenders(db: Db, chapterId: string): RenderRow[] {
  return db.select().from(renders).where(eq(renders.chapterId, chapterId)).orderBy(desc(renders.createdAt)).all();
}
