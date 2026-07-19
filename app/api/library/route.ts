import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getLibrary } from '@/lib/services/library';

export async function GET() {
  return NextResponse.json(getLibrary(getDb()));
}
