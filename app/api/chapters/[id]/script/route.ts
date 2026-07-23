import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '@/lib/db/client';
import { getChapter } from '@/lib/services/chapters';
import { importScript, latestScript } from '@/lib/services/scripts';
import { tServer } from '@/lib/i18n/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scr = latestScript(getDb(), id);
  if (!scr) return NextResponse.json({ error: tServer(req, 'error.noScript') }, { status: 404 });
  return new Response(scr.json, { headers: { 'Content-Type': 'application/json' } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getChapter(db, id)) return NextResponse.json({ error: tServer(req, 'error.chapterNotFound') }, { status: 404 });
  const text = await req.text();
  try {
    return NextResponse.json(importScript(db, id, text));
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: tServer(req, 'error.invalidJson', { message: e.message }) }, { status: 400 });
    if (e instanceof ZodError) {
      const issues = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      return NextResponse.json({ error: tServer(req, 'error.schemaError', { issues }) }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
