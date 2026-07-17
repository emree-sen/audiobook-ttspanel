import { eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chapters } from '../db/schema';
import { newId } from '../id';

export type Chapter = typeof chapters.$inferSelect;
export type ChapterPatch = { title?: string; rawText?: string; narrationStyle?: string | null; position?: number; status?: string; voiceMode?: string; maxCharacters?: number };

export function createChapter(db: Db, projectId: string, input: { title: string }): Chapter {
  const now = Date.now();
  const m = db.select({ m: max(chapters.position) }).from(chapters).where(eq(chapters.projectId, projectId)).get();
  const row: Chapter = {
    id: newId('chp'), projectId, position: (m?.m ?? 0) + 1, title: input.title,
    rawText: '', narrationStyle: null, voiceMode: 'narrator', maxCharacters: 6, status: 'draft', createdAt: now, updatedAt: now,
  };
  db.insert(chapters).values(row).run();
  return row;
}

export function listChapters(db: Db, projectId: string): Chapter[] {
  return db.select().from(chapters).where(eq(chapters.projectId, projectId)).orderBy(chapters.position).all();
}

export function getChapter(db: Db, id: string): Chapter | undefined {
  return db.select().from(chapters).where(eq(chapters.id, id)).get();
}

export function updateChapter(db: Db, id: string, patch: ChapterPatch): Chapter | undefined {
  db.update(chapters).set({ ...patch, updatedAt: Date.now() }).where(eq(chapters.id, id)).run();
  return getChapter(db, id);
}

export function deleteChapter(db: Db, id: string): void {
  db.delete(chapters).where(eq(chapters.id, id)).run();
}
