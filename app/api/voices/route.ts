import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { addOpenAiDefaults, addPiperModel, addVoice } from '@/lib/services/voices';

// Üç biçim: {provider, defaults:true} | {provider:'piper', path} | {provider, voice, gender?, tone?}
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.provider !== 'string' || !b.provider) return NextResponse.json({ error: 'provider gerekli' }, { status: 400 });
  const db = getDb();
  try {
    if (b.defaults === true) return NextResponse.json({ added: addOpenAiDefaults(db, b.provider) });
    if (typeof b.path === 'string') return NextResponse.json(addPiperModel(db, b.path), { status: 201 });
    if (typeof b.voice === 'string')
      return NextResponse.json(addVoice(db, {
        provider: b.provider, voice: b.voice,
        gender: typeof b.gender === 'string' ? b.gender : undefined,
        tone: typeof b.tone === 'string' ? b.tone : undefined,
      }), { status: 201 });
    return NextResponse.json({ error: 'voice, path veya defaults gerekli' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
