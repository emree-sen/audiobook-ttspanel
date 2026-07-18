import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { stitchLatest } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await stitchLatest(getDb(), id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
