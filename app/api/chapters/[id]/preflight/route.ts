import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getChapter } from '@/lib/services/chapters';
import { preflightChapter } from '@/lib/services/preflight';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getChapter(db, id)) return NextResponse.json({ error: 'Bölüm bulunamadı' }, { status: 404 });
  try {
    return NextResponse.json(preflightChapter(db, id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
