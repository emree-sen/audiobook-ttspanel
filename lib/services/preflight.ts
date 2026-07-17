import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { audioCache, scripts } from '../db/schema';
import { getSetting } from './settings';
import { latestScript, type ScriptRow } from './scripts';
import { activeProvider, quotaLimit, remainingToday, usedToday } from './quota';
import { parseScript } from '@/src/core/schema';
import { overrideAllVoices, resolveVoiceForSpeaker } from '@/src/core/voices';
import type { VoiceoverScript } from '@/src/core/types';

export interface PlanItem { idx: number; hash: string; text: string; style?: string; tags?: string[]; voiceId: string; pauseAfterMs?: number }

export function segmentHash(i: { provider: string; model: string; voice: string; style?: string; tags?: string[]; language: string; text: string }): string {
  return createHash('sha256')
    .update([i.provider, i.model, i.voice, i.style ?? '', (i.tags ?? []).join(','), i.language, i.text].join('|'))
    .digest('hex');
}

// Üretim planı: her segment için çözülmüş ses/stil + içerik hash'i.
// scriptId verilirse o versiyona sabitlenir (iş yürütme); yoksa en güncel (preflight).
export function planChapter(db: Db, chapterId: string, scriptId?: string): { scriptRow: ScriptRow; script: VoiceoverScript; plan: PlanItem[] } {
  const scr = scriptId
    ? db.select().from(scripts).where(eq(scripts.id, scriptId)).get()
    : latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script üretin');
  let script = parseScript(JSON.parse(scr.json));
  const single = getSetting(db, 'single_voice') ?? process.env.TTS_SINGLE_VOICE;
  if (single) script = overrideAllVoices(script, single);
  const { name: provider, model } = activeProvider(db);
  const plan = script.segments.map((seg, idx) => {
    const { cast } = resolveVoiceForSpeaker(script, seg.speaker);
    const style = [cast.baseStyle, seg.style].filter(Boolean).join(', ') || undefined; // orkestratörle aynı kural
    return {
      idx, text: seg.text, style, tags: seg.tags, voiceId: cast.voiceId, pauseAfterMs: seg.pauseAfterMs,
      hash: segmentHash({ provider, model, voice: cast.voiceId, style, tags: seg.tags, language: script.language, text: seg.text }),
    };
  });
  return { scriptRow: scr, script, plan };
}

export interface Preflight {
  total: number; cached: number; newCalls: number;
  quota: { provider: string; used: number; limit: number; remaining: number } | null;
  fits: boolean;
}

export function preflightChapter(db: Db, chapterId: string): Preflight {
  const { plan } = planChapter(db, chapterId);
  let cached = 0;
  for (const p of plan) if (db.select().from(audioCache).where(eq(audioCache.hash, p.hash)).get()) cached++;
  const newCalls = plan.length - cached;
  const { name: provider } = activeProvider(db);
  const limit = quotaLimit(db, provider);
  const quota = limit == null ? null : { provider, used: usedToday(db, provider), limit, remaining: remainingToday(db, provider)! };
  return { total: plan.length, cached, newCalls, quota, fits: quota == null || newCalls <= quota.remaining };
}
