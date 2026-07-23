import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteVoice, updateVoice } from '@/lib/services/voices';
import { langFromRequest, tServer } from '@/lib/i18n/server';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  // Task-1 known edge: updateVoice(db, id, {}) throws drizzle's "No values to set" when the
  // patch is empty. Guard here so an empty PATCH body returns a clean 400 instead.
  if (typeof b.gender !== 'string' && typeof b.tone !== 'string')
    return NextResponse.json({ error: tServer(req, 'error.genderOrToneRequired') }, { status: 400 });
  try {
    return NextResponse.json(updateVoice(getDb(), id, {
      gender: typeof b.gender === 'string' ? b.gender : undefined,
      tone: typeof b.tone === 'string' ? b.tone : undefined,
    }, langFromRequest(req)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteVoice(getDb(), id);
  return new Response(null, { status: 204 });
}
