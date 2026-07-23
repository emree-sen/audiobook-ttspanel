import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { stitchLatest } from '@/lib/services/producer';
import { langFromRequest } from '@/lib/i18n/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await stitchLatest(getDb(), id, langFromRequest(req)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
