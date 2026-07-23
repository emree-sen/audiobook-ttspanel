import { NextResponse, type NextRequest } from 'next/server';
import { deleteVoiceFile } from '@/lib/services/xtts-voices';
import { langFromRequest } from '@/lib/i18n/server';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  try {
    deleteVoiceFile(decodeURIComponent(name), undefined, langFromRequest(req));
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
