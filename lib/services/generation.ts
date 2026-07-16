import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { renders, segments } from '../db/schema';
import { newId } from '../id';
import { audioDir } from '../config';
import { getSetting } from './settings';
import { updateChapter } from './chapters';
import { latestScript, listSegments } from './scripts';
import { parseScript } from '@/src/core/schema';
import { generateEpisode } from '@/src/core/orchestrator';
import { overrideAllVoices } from '@/src/core/voices';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import type { TtsAdapter } from '@/src/core/types';

export type RenderRow = typeof renders.$inferSelect;
export interface GenerateOutcome { renderId: string; renderPath: string; segmentCount: number; failedCount: number; totalUsd: number; }

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

// Bölümün en güncel script'ini üretir; mp3 audioDir()/<chapterId>/<renderId>.mp3 olarak yazılır.
export async function generateChapter(
  db: Db, chapterId: string, adapter: TtsAdapter,
  onProgress?: (done: number, total: number) => void,
): Promise<GenerateOutcome> {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script yapıştırın');

  let script = parseScript(JSON.parse(scr.json));
  const single = getSetting(db, 'single_voice') ?? process.env.TTS_SINGLE_VOICE;
  if (single) script = overrideAllVoices(script, single);

  updateChapter(db, chapterId, { status: 'generating' });
  try {
    const r = await generateEpisode(script, adapter, onProgress);
    if (r.segments.length === 0) throw new Error('Hiç segment üretilemedi');

    const renderId = newId('rnd');
    const relPath = `${chapterId}/${renderId}.mp3`;
    await mkdir(join(audioDir(), chapterId), { recursive: true });
    await writeFile(join(audioDir(), relPath), r.mp3);

    const now = Date.now();
    db.insert(renders).values({ id: renderId, chapterId, scriptId: scr.id, path: relPath, durationSec: r.totalDurationMs / 1000, createdAt: now }).run();

    // Segment durumları: script segment id'si (s1, s2, ...) idx üzerinden eşlenir.
    const failedById = new Map(r.failed.map((f) => [f.id, f.error]));
    for (const row of listSegments(db, scr.id)) {
      const scriptSegId = script.segments[row.idx]?.id;
      const err = scriptSegId != null ? failedById.get(scriptSegId) : undefined;
      db.update(segments)
        .set(err ? { status: 'failed', error: err, updatedAt: now } : { status: 'done', error: null, updatedAt: now })
        .where(eq(segments.id, row.id)).run();
    }

    updateChapter(db, chapterId, { status: 'done' });
    return { renderId, renderPath: relPath, segmentCount: r.segments.length, failedCount: r.failed.length, totalUsd: r.totalUsd };
  } catch (e) {
    updateChapter(db, chapterId, { status: 'error' });
    throw e;
  }
}
