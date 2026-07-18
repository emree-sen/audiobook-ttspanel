import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { editSegment } from '@/lib/services/scripts';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === 'string' ? b.text : undefined;
  const style = typeof b.style === 'string' || b.style === null ? b.style : undefined;
  if (text === undefined && style === undefined) return NextResponse.json({ error: 'text veya style gerekli' }, { status: 400 });
  try {
    return NextResponse.json(editSegment(getDb(), id, { text, style }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
