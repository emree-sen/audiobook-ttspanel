import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteConnection, getConnection } from '@/lib/services/connections';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getConnection(db, id)) return NextResponse.json({ error: 'Bağlantı bulunamadı' }, { status: 404 });
  deleteConnection(db, id);
  return new Response(null, { status: 204 });
}
