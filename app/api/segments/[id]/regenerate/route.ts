import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { adapterFromSettings } from '@/lib/services/generation';
import { regenerateSegment } from '@/lib/services/producer';
import { langFromRequest } from '@/lib/i18n/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const lang = langFromRequest(req);
  try {
    return NextResponse.json(await regenerateSegment(db, id, adapterFromSettings(db, lang), lang));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
