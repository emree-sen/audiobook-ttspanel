import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createProject, listProjects } from '@/lib/services/projects';

export async function GET() {
  return NextResponse.json(listProjects(getDb()));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'title gerekli' }, { status: 400 });
  return NextResponse.json(createProject(getDb(), { title: body.title.trim(), description: body.description }), { status: 201 });
}
