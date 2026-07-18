import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createConnection, listConnections, type ConnectionRow } from '@/lib/services/connections';

// apiKey asla dışarı sızmaz — hasKey bayrağıyla gösterilir.
const pub = (c: ConnectionRow) => ({ id: c.id, label: c.label, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey });

export async function GET() {
  return NextResponse.json(listConnections(getDb()).map(pub));
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== 'string' || typeof b.baseUrl !== 'string' || typeof b.model !== 'string')
    return NextResponse.json({ error: 'id, baseUrl ve model gerekli' }, { status: 400 });
  try {
    return NextResponse.json(pub(createConnection(getDb(), {
      id: b.id, label: typeof b.label === 'string' ? b.label : undefined,
      baseUrl: b.baseUrl, apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined, model: b.model,
    })), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
