import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createProject, listProjects } from '@/lib/services/projects';
import { tServer } from '@/lib/i18n/server';

export async function GET() {
  return NextResponse.json(listProjects(getDb()));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: tServer(req, 'error.titleRequired') }, { status: 400 });
  return NextResponse.json(createProject(getDb(), { title: body.title.trim(), description: body.description }), { status: 201 });
}
