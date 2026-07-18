import { asc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { voices } from './db/schema';

export interface PoolVoice { voiceId: string; gender: string; tone: string }

// Sağlayıcının ses havuzu: voices tablosundan, ekleniş sırasıyla (tohum: Charon ilk).
export function loadPool(db: Db, provider: string): PoolVoice[] {
  return db.select().from(voices).where(eq(voices.provider, provider))
    .orderBy(asc(voices.createdAt), asc(voices.id)).all()
    .map((v) => ({ voiceId: `${v.provider}:${v.voice}`, gender: v.gender, tone: v.tone }));
}

// Cinsiyete uygun, kullanılmamış ilk ses; cinsiyet tutmuyorsa tüm havuz; havuz biterse deterministik döngü.
export function pickVoice(pool: PoolVoice[], gender: string, used: Set<string>): string {
  if (pool.length === 0) throw new Error('Aktif sağlayıcının ses havuzu boş — Ayarlar’dan ses ekleyin');
  const candidates = gender === 'male' || gender === 'female' ? pool.filter((v) => v.gender === gender) : pool;
  const base = candidates.length ? candidates : pool;
  const free = base.filter((v) => !used.has(v.voiceId));
  const pick = (free[0] ?? base[used.size % base.length]).voiceId;
  used.add(pick);
  return pick;
}
