import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { enqueueJob, ensureWorker } from '@/lib/services/producer';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const limitCalls = typeof body.limitCalls === 'number' && body.limitCalls >= 1 ? Math.floor(body.limitCalls) : undefined;
  try {
    const job = enqueueJob(db, id, { limitCalls });
    void ensureWorker(db); // arka planda sürer; yanıt beklemez
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
