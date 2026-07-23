import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { ensureWorker, latestJob } from '@/lib/services/producer';
import { listSegments } from '@/lib/services/scripts';
import { tServer } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  void ensureWorker(db); // yeniden başlatma sonrası bekleyen işleri toparlar
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): boolean => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); return true; }
        catch { return false; } // istemci koptu — iş etkilenmez
      };
      for (;;) {
        const job = latestJob(db, id);
        if (!job) { send('failed', { message: tServer(req, 'job.notFound') }); break; }
        const base = { jobId: job.id, done: job.doneCount, total: job.totalCount, status: job.status };
        if (job.status === 'running' || (job.status === 'queued' && !job.pausedReason)) {
          if (!send('progress', base)) break;
          await sleep(400);
          continue;
        }
        if (job.status === 'done') {
          const failedCount = listSegments(db, job.scriptId).filter((s) => s.status === 'failed').length;
          send('done', { ...base, failedCount });
        } else if (job.status === 'queued') {
          send('paused', { ...base, reason: job.pausedReason });
        } else {
          send('failed', { ...base, message: job.error ?? tServer(req, 'job.canceled') });
        }
        break;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
