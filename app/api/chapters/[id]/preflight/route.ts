import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getChapter } from '@/lib/services/chapters';
import { preflightChapter } from '@/lib/services/preflight';
import { langFromRequest, tServer } from '@/lib/i18n/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getChapter(db, id)) return NextResponse.json({ error: tServer(req, 'error.chapterNotFound') }, { status: 404 });
  try {
    return NextResponse.json(preflightChapter(db, id, langFromRequest(req)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
