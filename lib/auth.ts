// Web Crypto tabanlı (edge middleware + node uyumlu) basit HMAC oturum token'ı.
export const COOKIE_NAME = 'panel_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createToken(secret: string, now = Date.now()): Promise<string> {
  const body = `v1.${now + TTL_MS}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret: string, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [v, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return timingSafeEq(await hmac(secret, `${v}.${exp}`), sig);
}
