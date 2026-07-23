import { readFile } from 'node:fs/promises';
import type { NextRequest } from 'next/server';
import { safeAudioPath } from '@/lib/paths';
import { tServer } from '@/lib/i18n/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const full = safeAudioPath(path);
  if (!full) return new Response(tServer(req, 'error.notFound'), { status: 404 });
  try {
    const buf = await readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600' },
    });
  } catch {
    return new Response(tServer(req, 'error.notFound'), { status: 404 });
  }
}
