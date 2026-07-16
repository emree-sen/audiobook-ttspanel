import { NextResponse } from 'next/server';
import { COOKIE_NAME, createToken } from '@/lib/auth';

export async function POST(req: Request) {
  const secret = process.env.PANEL_PASSWORD;
  if (!secret) return NextResponse.json({ error: 'PANEL_PASSWORD ayarlı değil; auth kapalı' }, { status: 400 });
  const { password } = await req.json().catch(() => ({}));
  if (password !== secret) return NextResponse.json({ error: 'Hatalı şifre' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await createToken(secret), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
