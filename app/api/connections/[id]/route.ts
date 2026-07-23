import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteConnection, getConnection } from '@/lib/services/connections';
import { tServer } from '@/lib/i18n/server';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getConnection(db, id)) return NextResponse.json({ error: tServer(req, 'error.connectionNotFound') }, { status: 404 });
  deleteConnection(db, id);
  return new Response(null, { status: 204 });
}
