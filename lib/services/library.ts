import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { listeningProgress } from '../db/schema';
import { listProjects } from './projects';
import { getChapter, listChapters } from './chapters';
import { listRenders } from './generation';

export interface LibraryChapter {
  id: string; title: string; position: number; status: string;
  renderPath: string | null; durationSec: number | null;
  progressSec: number | null; progressUpdatedAt: number;
}
export interface LibrarySeries { project: { id: string; title: string }; chapters: LibraryChapter[] }

// Kütüphane: yalnız dinlenebilir (done) ve birleştirme bekleyen (voiced) bölümler.
export function getLibrary(db: Db): LibrarySeries[] {
  const out: LibrarySeries[] = [];
  for (const project of listProjects(db)) {
    const rows = listChapters(db, project.id).filter((c) => c.status === 'done' || c.status === 'voiced');
    if (rows.length === 0) continue;
    const chapters = rows.map((c) => {
      const render = c.status === 'done' ? listRenders(db, c.id)[0] : undefined;
      const prog = db.select().from(listeningProgress).where(eq(listeningProgress.chapterId, c.id)).get();
      return {
        id: c.id, title: c.title, position: c.position, status: c.status,
        renderPath: render?.path ?? null, durationSec: render?.durationSec ?? null,
        progressSec: prog?.positionSec ?? null, progressUpdatedAt: prog?.updatedAt ?? 0,
      };
    });
    out.push({ project: { id: project.id, title: project.title }, chapters });
  }
  return out;
}

export function saveProgress(db: Db, chapterId: string, p: { positionSec: number; durationSec?: number }): void {
  if (!getChapter(db, chapterId)) throw new Error('Bölüm bulunamadı');
  const now = Date.now();
  db.insert(listeningProgress)
    .values({ chapterId, positionSec: p.positionSec, durationSec: p.durationSec ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: listeningProgress.chapterId,
      set: { positionSec: p.positionSec, ...(p.durationSec != null ? { durationSec: p.durationSec } : {}), updatedAt: now },
    }).run();
}
