import { NextResponse, type NextRequest } from 'next/server';
import { deleteVoiceFile } from '@/lib/services/xtts-voices';
import { tServer } from '@/lib/i18n/server';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  try {
    deleteVoiceFile(decodeURIComponent(name));
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: tServer(req, 'xttsVoices.notFound') }, { status: 404 });
  }
}
