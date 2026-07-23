import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { changeCastVoice } from '@/lib/services/scripts';
import { langFromRequest, tServer } from '@/lib/i18n/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.characterId !== 'string' || typeof body.voiceId !== 'string') {
    return NextResponse.json({ error: tServer(req, 'error.characterAndVoiceRequired') }, { status: 400 });
  }
  try {
    return NextResponse.json(changeCastVoice(getDb(), id, body.characterId, body.voiceId, langFromRequest(req)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
