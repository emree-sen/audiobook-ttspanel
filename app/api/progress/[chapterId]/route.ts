import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { saveProgress } from '@/lib/services/library';

const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export async function PUT(req: Request, { params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId } = await params;
  const b = await req.json().catch(() => ({}));
  if (!okNum(b.positionSec) || (b.durationSec !== undefined && !okNum(b.durationSec)))
    return NextResponse.json({ error: 'positionSec (ve varsa durationSec) sonlu ve ≥ 0 olmalı' }, { status: 400 });
  try {
    saveProgress(getDb(), chapterId, { positionSec: b.positionSec, durationSec: b.durationSec });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
