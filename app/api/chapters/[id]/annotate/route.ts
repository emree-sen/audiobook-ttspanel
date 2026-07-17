import { getDb } from '@/lib/db/client';
import { annotateChapter, llmAdapterFromSettings } from '@/lib/services/annotation';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const instruction = typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim() : undefined;
  const db = getDb();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const adapter = llmAdapterFromSettings(db);
        const out = await annotateChapter(db, id, adapter, {
          instruction,
          onProgress: (done, total) => send('progress', { chunk: done, totalChunks: total }),
        });
        send('done', out);
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
