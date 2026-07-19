import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifyToken } from './lib/auth';

const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//];

export async function middleware(req: NextRequest) {
  const secret = process.env.PANEL_PASSWORD;
  if (!secret) return NextResponse.next(); // auth kapalı (lokal geliştirme) — README'de uyarı
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (await verifyToken(secret, req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/((?!_next/|favicon).*)'] };
