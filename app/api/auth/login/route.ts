import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, createToken } from '@/lib/auth';
import { tServer } from '@/lib/i18n/server';

export async function POST(req: NextRequest) {
  const secret = process.env.PANEL_PASSWORD;
  if (!secret) return NextResponse.json({ error: tServer(req, 'error.authNotConfigured') }, { status: 400 });
  const { password } = await req.json().catch(() => ({}));
  if (password !== secret) return NextResponse.json({ error: tServer(req, 'error.wrongPassword') }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await createToken(secret), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
