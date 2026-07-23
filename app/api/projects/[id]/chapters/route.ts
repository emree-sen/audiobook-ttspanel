import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { tServer } from '@/lib/i18n/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(getDb(), id)) return NextResponse.json({ error: tServer(req, 'error.projectNotFound') }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: tServer(req, 'error.titleRequired') }, { status: 400 });
  return NextResponse.json(createChapter(getDb(), id, { title: body.title.trim() }), { status: 201 });
}
