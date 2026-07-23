import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { tServer } from '@/lib/i18n/server';

const schema = z.object({ kind: z.enum(['llm', 'tts']), baseUrl: z.string().min(1) });

// Sunucu-tarafı bağlantı sınama: tarayıcıdan CORS'a takılmadan lokal sunucuları yoklar.
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: tServer(req, 'error.invalidBody') }, { status: 400 });
  const { kind, baseUrl } = parsed.data;
  const base = baseUrl.replace(/\/+$/, '');
  const url = kind === 'llm' ? `${base}/models` : `${base.replace(/\/v1$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NextResponse.json({ ok: false, detail: tServer(req, 'probe.httpError', { status: res.status }) });
    const data = (await res.json().catch(() => null)) as { data?: unknown[]; voices?: unknown[] } | null;
    const count = kind === 'llm'
      ? (Array.isArray(data?.data) ? data.data.length : 0)
      : (Array.isArray(data?.voices) ? data.voices.length : 0);
    return NextResponse.json({ ok: true, detail: tServer(req, kind === 'llm' ? 'probe.okModels' : 'probe.okVoices', { count }) });
  } catch {
    return NextResponse.json({ ok: false, detail: tServer(req, 'probe.unreachable') });
  }
}
