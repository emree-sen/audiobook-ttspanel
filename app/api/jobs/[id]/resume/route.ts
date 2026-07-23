import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { ensureWorker, resumeJob } from '@/lib/services/producer';
import { langFromRequest } from '@/lib/i18n/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    const job = resumeJob(db, id, langFromRequest(req));
    void ensureWorker(db);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
