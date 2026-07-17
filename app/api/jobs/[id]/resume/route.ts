import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { ensureWorker, resumeJob } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    const job = resumeJob(db, id);
    void ensureWorker(db);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
