import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteChapter, getChapter, updateChapter } from '@/lib/services/chapters';
import { latestScript, listSegments } from '@/lib/services/scripts';
import { renders } from '@/lib/db/schema';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const chapter = getChapter(db, id);
  if (!chapter) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  const scr = latestScript(db, id);
  const segments = scr ? listSegments(db, scr.id) : [];
  const renderRows = db.select().from(renders).where(eq(renders.chapterId, id)).orderBy(desc(renders.createdAt)).all();
  return NextResponse.json({
    chapter,
    script: scr ? { id: scr.id, version: scr.version, segmentCount: segments.length } : null,
    segments,
    renders: renderRows,
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = updateChapter(getDb(), id, { title: body.title, rawText: body.rawText, narrationStyle: body.narrationStyle });
  if (!updated) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteChapter(getDb(), (await params).id);
  return new NextResponse(null, { status: 204 });
}
