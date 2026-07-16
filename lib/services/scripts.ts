import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { scripts, segments } from '../db/schema';
import { newId } from '../id';
import { updateChapter } from './chapters';
import { parseScript } from '@/src/core/schema';
import { resolveVoiceForSpeaker, validateSpeakers } from '@/src/core/voices';

export type ScriptRow = typeof scripts.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;

// Elle yapıştırılan JSON script'i doğrular ve versiyonlu olarak kaydeder.
// Geçersiz girişte fırlatır (SyntaxError | ZodError | Error) — hiçbir satır yazılmaz.
export function importScript(db: Db, chapterId: string, jsonText: string): { scriptId: string; version: number; segmentCount: number } {
  const parsed = parseScript(JSON.parse(jsonText));
  validateSpeakers(parsed); // bilinmeyen konuşmacı varsa erken ve anlaşılır hata

  const last = db.select({ v: scripts.version }).from(scripts)
    .where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
  const version = (last?.v ?? 0) + 1;
  const scriptId = newId('scr');
  const now = Date.now();

  db.insert(scripts).values({ id: scriptId, chapterId, version, source: 'manual', json: jsonText, createdAt: now }).run();
  db.insert(segments).values(parsed.segments.map((s, i) => ({
    id: newId('seg'), chapterId, scriptId, idx: i,
    speaker: s.speaker, style: s.style ?? null, text: s.text,
    voice: resolveVoiceForSpeaker(parsed, s.speaker).cast.voiceId,
    status: 'pending', createdAt: now, updatedAt: now,
  }))).run();
  updateChapter(db, chapterId, { status: 'scripted' });

  return { scriptId, version, segmentCount: parsed.segments.length };
}

export function latestScript(db: Db, chapterId: string): ScriptRow | undefined {
  return db.select().from(scripts).where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
}

export function listSegments(db: Db, scriptId: string): SegmentRow[] {
  return db.select().from(segments).where(eq(segments.scriptId, scriptId)).orderBy(segments.idx).all();
}
