// app/api/xtts/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import path from 'node:path';
import { xttsStart, xttsStatus, xttsStop } from '@/lib/services/xtts-sidecar';
import { tServer } from '@/lib/i18n/server';

const DIR = path.join(process.cwd(), 'tools', 'xtts-server');

// Durum: süreç yaşıyorsa /health'e sorup starting/running ayrımı yapılır.
export async function GET() {
  const s = xttsStatus();
  let state: 'stopped' | 'starting' | 'running' | 'error' = s.alive ? 'starting' : s.exitInfo ? 'error' : 'stopped';
  let voices: string[] = [];
  if (s.alive) {
    try {
      const res = await fetch('http://localhost:8020/health', { signal: AbortSignal.timeout(1500) });
      if (res.ok) { state = 'running'; voices = ((await res.json()) as { voices?: string[] }).voices ?? []; }
    } catch { /* hâlâ açılıyor */ }
  }
  return NextResponse.json({ state, log: s.log, exitInfo: s.exitInfo, voices });
}

export async function POST(req: NextRequest) {
  if (xttsStatus().alive) return NextResponse.json({ error: tServer(req, 'xtts.alreadyRunning') }, { status: 409 });
  xttsStart(DIR);
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function DELETE(req: NextRequest) {
  if (!xttsStatus().alive) return NextResponse.json({ error: tServer(req, 'xtts.notRunning') }, { status: 409 });
  xttsStop();
  return NextResponse.json({ ok: true });
}
