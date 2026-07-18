import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { voices } from '../db/schema';
import { newId } from '../id';

export type VoiceRow = typeof voices.$inferSelect;

export const OPENAI_DEFAULT_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
const GENDERS = ['male', 'female', ''];

export function listVoices(db: Db, provider: string): VoiceRow[] {
  return db.select().from(voices).where(eq(voices.provider, provider))
    .orderBy(asc(voices.createdAt), asc(voices.id)).all();
}

export function addVoice(db: Db, v: { provider: string; voice: string; gender?: string; tone?: string; path?: string }): VoiceRow {
  const voice = v.voice?.trim();
  if (!voice) throw new Error('Ses adı gerekli');
  const gender = v.gender ?? '';
  if (!GENDERS.includes(gender)) throw new Error('Geçersiz cinsiyet (male, female veya boş)');
  if (db.select().from(voices).where(eq(voices.provider, v.provider)).all().some((r) => r.voice === voice))
    throw new Error('Bu ses zaten havuzda');
  const row: VoiceRow = {
    id: newId('voc'), provider: v.provider, voice, gender,
    tone: v.tone?.trim() ?? '', path: v.path ?? null, createdAt: Date.now(),
  };
  db.insert(voices).values(row).run();
  return row;
}

// Piper: ses adı .onnx dosya adından türer (ör. tr_TR-fahrettin-medium).
export function addPiperModel(db: Db, path: string): VoiceRow {
  const p = path.trim();
  if (!/\.onnx$/i.test(p)) throw new Error('Piper modeli .onnx dosyası olmalı');
  const base = p.split(/[\\/]/).pop()!;
  return addVoice(db, { provider: 'piper', voice: base.replace(/\.onnx$/i, ''), path: p });
}

// Resmî OpenAI seslerini ekler; mevcut olanları atlar. Eklenen sayıyı döndürür.
export function addOpenAiDefaults(db: Db, provider: string): number {
  const existing = new Set(listVoices(db, provider).map((v) => v.voice));
  let n = 0;
  for (const voice of OPENAI_DEFAULT_VOICES) {
    if (existing.has(voice)) continue;
    addVoice(db, { provider, voice });
    n++;
  }
  return n;
}

export function updateVoice(db: Db, id: string, patch: { gender?: string; tone?: string }): VoiceRow {
  const row = db.select().from(voices).where(eq(voices.id, id)).get();
  if (!row) throw new Error('Ses bulunamadı');
  if (patch.gender !== undefined && !GENDERS.includes(patch.gender)) throw new Error('Geçersiz cinsiyet (male, female veya boş)');
  db.update(voices).set({
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.tone !== undefined ? { tone: patch.tone.trim() } : {}),
  }).where(eq(voices.id, id)).run();
  return db.select().from(voices).where(eq(voices.id, id)).get()!;
}

export function deleteVoice(db: Db, id: string): void {
  db.delete(voices).where(eq(voices.id, id)).run();
}
