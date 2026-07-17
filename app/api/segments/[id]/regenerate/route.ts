import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { adapterFromSettings } from '@/lib/services/generation';
import { regenerateSegment } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    return NextResponse.json(await regenerateSegment(db, id, adapterFromSettings(db)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
