import { readFile } from 'node:fs/promises';
import { safeAudioPath } from '@/lib/paths';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const full = safeAudioPath(path);
  if (!full) return new Response('Bulunamadı', { status: 404 });
  try {
    const buf = await readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600' },
    });
  } catch {
    return new Response('Bulunamadı', { status: 404 });
  }
}
