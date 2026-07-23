// lib/i18n/server.ts
import type { NextRequest } from 'next/server';
import { LANG_COOKIE, resolveLang, t, type MessageKey } from './index';

export function langFromRequest(req: NextRequest) {
  return resolveLang(req.cookies.get(LANG_COOKIE)?.value, req.headers.get('accept-language') ?? undefined);
}

export function tServer(req: NextRequest, key: MessageKey, params?: Record<string, string | number>): string {
  return t(langFromRequest(req), key, params);
}
