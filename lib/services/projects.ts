import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects } from '../db/schema';
import { newId } from '../id';

export type Project = typeof projects.$inferSelect;

export function createProject(db: Db, input: { title: string; description?: string }): Project {
  const now = Date.now();
  const row: Project = { id: newId('prj'), title: input.title, description: input.description ?? null, createdAt: now, updatedAt: now };
  db.insert(projects).values(row).run();
  return row;
}

export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(projects.createdAt).all();
}

export function getProject(db: Db, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function updateProject(db: Db, id: string, patch: { title?: string; description?: string }): Project | undefined {
  db.update(projects).set({ ...patch, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
  return getProject(db, id);
}

export function deleteProject(db: Db, id: string): void {
  db.delete(projects).where(eq(projects.id, id)).run();
}
