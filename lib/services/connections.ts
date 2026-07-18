import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ttsConnections, voices } from '../db/schema';
import { deleteSetting, getSetting } from './settings';

export type ConnectionRow = typeof ttsConnections.$inferSelect;

export const RESERVED_PROVIDERS = ['gemini', 'piper', 'mock', 'openai'];
const SLUG_RE = /^[a-z0-9-]{2,32}$/;

export function listConnections(db: Db): ConnectionRow[] {
  return db.select().from(ttsConnections).orderBy(asc(ttsConnections.createdAt)).all();
}

export function getConnection(db: Db, id: string): ConnectionRow | undefined {
  return db.select().from(ttsConnections).where(eq(ttsConnections.id, id)).get();
}

export function createConnection(db: Db, c: { id: string; label?: string; baseUrl: string; apiKey?: string; model: string }): ConnectionRow {
  if (!SLUG_RE.test(c.id)) throw new Error('Geçersiz bağlantı adı: küçük harf/rakam/tire, 2-32 karakter (ör. "alltalk-lokal")');
  if (RESERVED_PROVIDERS.includes(c.id)) throw new Error(`"${c.id}" rezerve bir sağlayıcı adı — başka bir ad seçin`);
  if (getConnection(db, c.id)) throw new Error('Bu adla bir bağlantı zaten var');
  try { new URL(c.baseUrl); } catch { throw new Error('Geçersiz URL (ör. http://localhost:8000/v1)'); }
  if (!c.model.trim()) throw new Error('model gerekli (ör. tts-1)');
  const now = Date.now();
  const row: ConnectionRow = {
    id: c.id, label: c.label?.trim() || c.id, baseUrl: c.baseUrl.trim(),
    apiKey: c.apiKey?.trim() || null, model: c.model.trim(), createdAt: now, updatedAt: now,
  };
  db.insert(ttsConnections).values(row).run();
  return row;
}

export function deleteConnection(db: Db, id: string): void {
  db.delete(voices).where(eq(voices.provider, id)).run(); // havuzu temizle
  db.delete(ttsConnections).where(eq(ttsConnections.id, id)).run();
  // Aktif sağlayıcı silinen bağlantıysa varsayılana (gemini) düşür.
  if (getSetting(db, 'provider') === id) deleteSetting(db, 'provider');
}
