import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { voices } from '../db/schema';
import { newId } from '../id';
import { t, type Lang } from '../i18n';

export type VoiceRow = typeof voices.$inferSelect;

export const OPENAI_DEFAULT_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
const GENDERS = ['male', 'female', ''];

export function listVoices(db: Db, provider: string): VoiceRow[] {
  return db.select().from(voices).where(eq(voices.provider, provider))
    .orderBy(asc(voices.createdAt), asc(voices.id)).all();
}

export function addVoice(db: Db, v: { provider: string; voice: string; gender?: string; tone?: string; path?: string }, lang: Lang = 'tr'): VoiceRow {
  const voice = v.voice?.trim();
  if (!voice) throw new Error(t(lang, 'error.voiceNameRequired'));
  const gender = v.gender ?? '';
  if (!GENDERS.includes(gender)) throw new Error(t(lang, 'error.invalidGender'));
  if (db.select().from(voices).where(eq(voices.provider, v.provider)).all().some((r) => r.voice === voice))
    throw new Error(t(lang, 'error.voiceAlreadyInPool'));
  const row: VoiceRow = {
    id: newId('voc'), provider: v.provider, voice, gender,
    tone: v.tone?.trim() ?? '', path: v.path ?? null, createdAt: Date.now(),
  };
  db.insert(voices).values(row).run();
  return row;
}

// Piper: ses adı .onnx dosya adından türer (ör. tr_TR-fahrettin-medium).
export function addPiperModel(db: Db, path: string, lang: Lang = 'tr'): VoiceRow {
  const p = path.trim();
  if (!/\.onnx$/i.test(p)) throw new Error(t(lang, 'error.piperModelMustBeOnnx'));
  const base = p.split(/[\\/]/).pop()!;
  return addVoice(db, { provider: 'piper', voice: base.replace(/\.onnx$/i, ''), path: p }, lang);
}

// Resmî OpenAI seslerini ekler; mevcut olanları atlar. Eklenen sayıyı döndürür.
export function addOpenAiDefaults(db: Db, provider: string, lang: Lang = 'tr'): number {
  const existing = new Set(listVoices(db, provider).map((v) => v.voice));
  let n = 0;
  for (const voice of OPENAI_DEFAULT_VOICES) {
    if (existing.has(voice)) continue;
    addVoice(db, { provider, voice }, lang);
    n++;
  }
  return n;
}

export function updateVoice(db: Db, id: string, patch: { gender?: string; tone?: string }, lang: Lang = 'tr'): VoiceRow {
  const row = db.select().from(voices).where(eq(voices.id, id)).get();
  if (!row) throw new Error(t(lang, 'error.voiceNotFound'));
  if (patch.gender !== undefined && !GENDERS.includes(patch.gender)) throw new Error(t(lang, 'error.invalidGender'));
  db.update(voices).set({
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.tone !== undefined ? { tone: patch.tone.trim() } : {}),
  }).where(eq(voices.id, id)).run();
  return db.select().from(voices).where(eq(voices.id, id)).get()!;
}

export function deleteVoice(db: Db, id: string): void {
  db.delete(voices).where(eq(voices.id, id)).run();
}
