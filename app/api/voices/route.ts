import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { addOpenAiDefaults, addPiperModel, addVoice } from '@/lib/services/voices';
import { langFromRequest, tServer } from '@/lib/i18n/server';

// Üç biçim: {provider, defaults:true} | {provider:'piper', path} | {provider, voice, gender?, tone?}
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.provider !== 'string' || !b.provider) return NextResponse.json({ error: tServer(req, 'error.providerRequired') }, { status: 400 });
  const db = getDb();
  const lang = langFromRequest(req);
  try {
    if (b.defaults === true) return NextResponse.json({ added: addOpenAiDefaults(db, b.provider, lang) });
    if (typeof b.path === 'string') return NextResponse.json(addPiperModel(db, b.path, lang), { status: 201 });
    if (typeof b.voice === 'string')
      return NextResponse.json(addVoice(db, {
        provider: b.provider, voice: b.voice,
        gender: typeof b.gender === 'string' ? b.gender : undefined,
        tone: typeof b.tone === 'string' ? b.tone : undefined,
      }, lang), { status: 201 });
    return NextResponse.json({ error: tServer(req, 'error.voiceOrPathOrDefaultsRequired') }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
