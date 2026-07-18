import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { scripts, segments } from '../db/schema';
import { newId } from '../id';
import { updateChapter } from './chapters';
import { parseScript } from '@/src/core/schema';
import { parseVoiceId, resolveVoiceForSpeaker, validateSpeakers } from '@/src/core/voices';

export type ScriptRow = typeof scripts.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;

// Script JSON'unu doğrular ve versiyonlu kaydeder (manual: elle yapıştırma, llm: annotation).
// Geçersiz girişte fırlatır (SyntaxError | ZodError | Error) — hiçbir satır yazılmaz.
export function saveScript(db: Db, chapterId: string, jsonText: string, source: 'manual' | 'llm', usageJson?: string): { scriptId: string; version: number; segmentCount: number } {
  const parsed = parseScript(JSON.parse(jsonText));
  validateSpeakers(parsed); // bilinmeyen konuşmacı varsa erken ve anlaşılır hata

  const last = db.select({ v: scripts.version }).from(scripts)
    .where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
  const version = (last?.v ?? 0) + 1;
  const scriptId = newId('scr');
  const now = Date.now();

  db.insert(scripts).values({ id: scriptId, chapterId, version, source, json: jsonText, usageJson: usageJson ?? null, createdAt: now }).run();
  db.insert(segments).values(parsed.segments.map((s, i) => ({
    id: newId('seg'), chapterId, scriptId, idx: i,
    speaker: s.speaker, style: s.style ?? null, text: s.text,
    voice: resolveVoiceForSpeaker(parsed, s.speaker).cast.voiceId,
    status: 'pending', createdAt: now, updatedAt: now,
  }))).run();
  updateChapter(db, chapterId, { status: 'scripted' });

  return { scriptId, version, segmentCount: parsed.segments.length };
}

export function importScript(db: Db, chapterId: string, jsonText: string): { scriptId: string; version: number; segmentCount: number } {
  return saveScript(db, chapterId, jsonText, 'manual');
}

// En güncel script'in cast'inde bir karakterin sesini değiştirip yeni versiyon yazar (LLM çağrısı yok).
export function changeCastVoice(db: Db, chapterId: string, characterId: string, voiceId: string): { scriptId: string; version: number } {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script\'i yok');
  parseVoiceId(voiceId); // format doğrulaması (geçersizse fırlatır)
  const json = JSON.parse(scr.json) as { cast?: { character_id: string; voice_id: string }[] };
  const member = json.cast?.find((c) => c.character_id === characterId);
  if (!member) throw new Error(`Karakter bulunamadı: "${characterId}"`);
  member.voice_id = voiceId;
  const saved = saveScript(db, chapterId, JSON.stringify(json), scr.source as 'manual' | 'llm', scr.usageJson ?? undefined);
  return { scriptId: saved.scriptId, version: saved.version };
}

// En güncel scriptte TEK segmentin metnini/stilini değiştirip yeni versiyon yazar (LLM/TTS çağrısı yok).
// Hash değişir → üretimde yalnız bu segment yeni çağrı olur; kalanlar cache'ten (C1).
export function editSegment(db: Db, segmentId: string, patch: { text?: string; style?: string | null }): { scriptId: string; version: number } {
  const row = db.select().from(segments).where(eq(segments.id, segmentId)).get();
  if (!row) throw new Error('Segment bulunamadı');
  const scr = latestScript(db, row.chapterId);
  if (!scr || scr.id !== row.scriptId) throw new Error('Segment güncel script’e ait değil — sayfayı yenileyin');
  if (patch.text !== undefined && !patch.text.trim()) throw new Error('Segment metni boş olamaz');
  const json = JSON.parse(scr.json) as { segments: { text: string; style?: string }[] };
  const seg = json.segments[row.idx];
  if (!seg) throw new Error('Segment script içinde bulunamadı');
  if (patch.text !== undefined) seg.text = patch.text.trim();
  if (patch.style !== undefined) { if (patch.style?.trim()) seg.style = patch.style.trim(); else delete seg.style; }
  const saved = saveScript(db, row.chapterId, JSON.stringify(json), scr.source as 'manual' | 'llm', scr.usageJson ?? undefined);
  return { scriptId: saved.scriptId, version: saved.version };
}

export function latestScript(db: Db, chapterId: string): ScriptRow | undefined {
  return db.select().from(scripts).where(eq(scripts.chapterId, chapterId)).orderBy(desc(scripts.version)).limit(1).get();
}

export function listSegments(db: Db, scriptId: string): SegmentRow[] {
  return db.select().from(segments).where(eq(segments.scriptId, scriptId)).orderBy(segments.idx).all();
}
