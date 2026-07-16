import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(getDb(), id)) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'title gerekli' }, { status: 400 });
  return NextResponse.json(createChapter(getDb(), id, { title: body.title.trim() }), { status: 201 });
}
