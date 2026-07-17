import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { listProjects } from '@/lib/services/projects';
import { listChapters } from '@/lib/services/chapters';

// Sol panel + (ileride) kütüphane için tek sorguda proje→bölüm ağacı.
export async function GET() {
  const db = getDb();
  return NextResponse.json(listProjects(db).map((project) => ({ project, chapters: listChapters(db, project.id) })));
}
