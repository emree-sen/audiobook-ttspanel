import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { changeCastVoice } from '@/lib/services/scripts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.characterId !== 'string' || typeof body.voiceId !== 'string') {
    return NextResponse.json({ error: 'characterId ve voiceId gerekli' }, { status: 400 });
  }
  try {
    return NextResponse.json(changeCastVoice(getDb(), id, body.characterId, body.voiceId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
