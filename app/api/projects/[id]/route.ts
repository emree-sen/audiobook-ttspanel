import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteProject, getProject, updateProject } from '@/lib/services/projects';
import { listChapters } from '@/lib/services/chapters';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(getDb(), id);
  if (!project) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  return NextResponse.json({ project, chapters: listChapters(getDb(), id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = updateProject(getDb(), id, { title: body.title, description: body.description });
  if (!updated) return NextResponse.json({ error: 'Proje bulunamadı' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteProject(getDb(), (await params).id);
  return new NextResponse(null, { status: 204 });
}
