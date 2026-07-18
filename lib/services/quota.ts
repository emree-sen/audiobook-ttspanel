import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ttsConnections, ttsCalls } from '../db/schema';
import { newId } from '../id';
import { getSetting } from './settings';

// Sağlayıcının kota gününün sıfırlandığı saat dilimi (gemini: gece PT).
const RESET_TZ: Record<string, string> = { gemini: 'America/Los_Angeles' };
const DEFAULT_LIMITS: Record<string, number> = { gemini: 100 };

export function activeProvider(db: Db): { name: string; model: string } {
  const name = getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini';
  if (name === 'gemini' || name === 'mock')
    return { name, model: getSetting(db, 'model') ?? process.env.TTS_MODEL ?? '' };
  if (name === 'piper') return { name, model: '' };
  // OpenAI-uyumlu bağlantı: model bağlantı satırından (servis importu yok — döngü riski taşımasın diye tabloya doğrudan bakılır).
  // baseUrl model'e katılır: aynı slug farklı sunucuya işaret ederse hash değişsin (eski cache sunulmasın).
  const conn = db.select().from(ttsConnections).where(eq(ttsConnections.id, name)).get();
  return { name, model: conn ? `${conn.model}@${conn.baseUrl}` : '' };
}

export function quotaDay(provider: string, at = Date.now()): string {
  const timeZone = RESET_TZ[provider] ?? 'UTC';
  // en-CA yerel biçimi YYYY-MM-DD verir
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function recordCall(db: Db, c: { provider: string; model?: string; segmentId?: string; ok?: boolean; usd?: number; at?: number }): void {
  const at = c.at ?? Date.now();
  db.insert(ttsCalls).values({
    id: newId('cal'), provider: c.provider, model: c.model ?? '', day: quotaDay(c.provider, at),
    segmentId: c.segmentId ?? null, ok: c.ok === false ? 0 : 1, usd: c.usd ?? 0, createdAt: at,
  }).run();
}

export function usedToday(db: Db, provider: string, at = Date.now()): number {
  const r = db.select({ n: sql<number>`count(*)` }).from(ttsCalls)
    .where(and(eq(ttsCalls.provider, provider), eq(ttsCalls.day, quotaDay(provider, at)))).get();
  return r?.n ?? 0;
}

export function quotaLimit(db: Db, provider: string): number | null {
  const s = getSetting(db, `quota_limit_${provider}`);
  if (s != null) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  return DEFAULT_LIMITS[provider] ?? null;
}

export function remainingToday(db: Db, provider: string, at = Date.now()): number | null {
  const limit = quotaLimit(db, provider);
  if (limit == null) return null;
  return Math.max(0, limit - usedToday(db, provider, at));
}
