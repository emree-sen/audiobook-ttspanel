// lib/i18n/index.ts
import { tr, type MessageKey } from './tr';
import { en } from './en';

export type Lang = 'tr' | 'en';
export type { MessageKey };
export const LANG_COOKIE = 'lang';

export function getDict(lang: Lang): Record<MessageKey, string> {
  return lang === 'tr' ? tr : en;
}

// Cookie geçerliyse o; değilse Accept-Language'ın EN YÜKSEK öncelikli dili tr ise tr; aksi halde en.
export function resolveLang(cookieValue: string | undefined, acceptLanguage: string | undefined): Lang {
  if (cookieValue === 'tr' || cookieValue === 'en') return cookieValue;
  const first = (acceptLanguage ?? '')
    .split(',')
    .map((p) => {
      const [tag, ...params] = p.trim().split(';');
      const q = Number(params.find((x) => x.trim().startsWith('q='))?.split('=')[1] ?? '1');
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)[0];
  return first?.tag.startsWith('tr') ? 'tr' : 'en';
}

export function format(msg: string, params: Record<string, string | number>): string {
  return msg.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

// req'siz katmanlar (servisler) için: dil, çağıran (route) tarafından istek anında
// resolveLang ile belirlenip parametre olarak taşınır — burada yeniden çözülmez.
export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const msg = getDict(lang)[key];
  return params ? format(msg, params) : msg;
}
