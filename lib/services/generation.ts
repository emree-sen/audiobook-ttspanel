import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders } from '../db/schema';
import { getSetting } from './settings';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;

// Ayarlar (settings tablosu) → env → varsayılan sırasıyla adapter kur.
export function adapterFromSettings(db: Db): TtsAdapter {
  const provider = getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockAdapter();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil (.env)');
  return new GeminiAdapter(key, getSetting(db, 'model') ?? process.env.TTS_MODEL);
}

export function listRenders(db: Db, chapterId: string): RenderRow[] {
  return db.select().from(renders).where(eq(renders.chapterId, chapterId)).orderBy(desc(renders.createdAt)).all();
}
