import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteChapter, getChapter, updateChapter } from '@/lib/services/chapters';
import { latestScript, listSegments } from '@/lib/services/scripts';
import { listRenders } from '@/lib/services/generation';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const chapter = getChapter(db, id);
  if (!chapter) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  const scr = latestScript(db, id);
  const segments = scr ? listSegments(db, scr.id) : [];
  let cast: unknown[] = [];
  if (scr) { try { cast = JSON.parse(scr.json).cast ?? []; } catch { /* bozuk json'u yok say */ } }
  return NextResponse.json({
    chapter,
    script: scr ? {
      id: scr.id, version: scr.version, segmentCount: segments.length,
      source: scr.source, usage: scr.usageJson ? JSON.parse(scr.usageJson) : null,
    } : null,
    cast,
    segments,
    renders: listRenders(db, id),
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateChapter>[2] = { title: body.title, rawText: body.rawText, narrationStyle: body.narrationStyle };
  if (typeof body.position === 'number') patch.position = body.position;
  if (body.voiceMode === 'narrator' || body.voiceMode === 'multi') patch.voiceMode = body.voiceMode;
  if (typeof body.maxCharacters === 'number' && body.maxCharacters >= 1) patch.maxCharacters = Math.floor(body.maxCharacters);
  const updated = updateChapter(getDb(), id, patch);
  if (!updated) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteChapter(getDb(), (await params).id);
  return new NextResponse(null, { status: 204 });
}
