import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { audioCache, jobs, renders, segments } from '../db/schema';
import { newId } from '../id';
import { audioDir } from '../config';
import { t, type Lang } from '../i18n';
import { getChapter, updateChapter } from './chapters';
import { latestScript, listSegments } from './scripts';
import { activeProvider, recordCall, remainingToday } from './quota';
import { planChapter } from './preflight';
import { adapterFromSettings } from './generation';
import { parseVoiceId } from '@/src/core/voices';
import { concatSegmentsToWav, wavToMp3 } from '@/src/core/audio/stitch';
import type { TtsAdapter, TtsResult, TtsSegmentRequest } from '@/src/core/types';

export type JobRow = typeof jobs.$inferSelect;

export function latestJob(db: Db, chapterId: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.chapterId, chapterId)).orderBy(desc(jobs.createdAt)).limit(1).get();
}

function setJob(db: Db, id: string, patch: Partial<JobRow>): void {
  db.update(jobs).set({ ...patch, updatedAt: Date.now() }).where(eq(jobs.id, id)).run();
}

// Bölüm için yeni iş kuyruklar; aktif işi iptal eder, segment durumlarını sıfırlar.
export function enqueueJob(db: Db, chapterId: string, opts?: { limitCalls?: number; lang?: Lang }): JobRow {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error(t(opts?.lang ?? 'tr', 'error.noScriptGenerateFirst'));
  const now = Date.now();
  db.update(jobs).set({ status: 'canceled', updatedAt: now })
    .where(and(eq(jobs.chapterId, chapterId), inArray(jobs.status, ['queued', 'running']))).run();
  const total = listSegments(db, scr.id).length;
  db.update(segments).set({ status: 'pending', error: null, updatedAt: now }).where(eq(segments.scriptId, scr.id)).run();
  const job: JobRow = {
    id: newId('job'), chapterId, scriptId: scr.id, status: 'queued',
    limitCalls: opts?.limitCalls ?? null, callsUsed: 0, doneCount: 0, totalCount: total,
    pausedReason: null, error: null, createdAt: now, updatedAt: now,
  };
  db.insert(jobs).values(job).run();
  updateChapter(db, chapterId, { status: 'generating' });
  return job;
}

// done segmentlerin dosyalarından bölüm mp3'ü birleştirir (pauseAfterMs korunur).
export async function stitchChapter(db: Db, chapterId: string, scriptId: string, lang: Lang = 'tr'): Promise<{ renderId: string; renderPath: string; durationSec: number }> {
  const { plan } = planChapter(db, chapterId, scriptId, lang);
  const parts: { wav: Buffer; pauseAfterMs?: number }[] = [];
  let totalMs = 0;
  for (const row of listSegments(db, scriptId)) {
    if (row.status !== 'done' || !row.audioPath) continue;
    parts.push({ wav: await readFile(join(audioDir(), row.audioPath)), pauseAfterMs: plan[row.idx]?.pauseAfterMs });
    if (row.contentHash) {
      const c = db.select().from(audioCache).where(eq(audioCache.hash, row.contentHash)).get();
      totalMs += c?.durationMs ?? 0;
    }
  }
  if (parts.length === 0) throw new Error(t(lang, 'job.noSegmentsProduced'));
  const mp3 = await wavToMp3(concatSegmentsToWav(parts));
  const renderId = newId('rnd');
  const relPath = `${chapterId}/${renderId}.mp3`;
  await mkdir(join(audioDir(), chapterId), { recursive: true });
  await writeFile(join(audioDir(), relPath), mp3);
  db.insert(renders).values({ id: renderId, chapterId, scriptId, path: relPath, durationSec: totalMs / 1000, createdAt: Date.now() }).run();
  return { renderId, renderPath: relPath, durationSec: totalMs / 1000 };
}

// Birleştirme artık bilinçli bir adım: en güncel script'in done segmentlerinden mp3 üretir.
export async function stitchLatest(db: Db, chapterId: string, lang: Lang = 'tr'): Promise<{ renderId: string; renderPath: string; durationSec: number }> {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error(t(lang, 'error.noScriptGenerateFirst'));
  const active = db.select().from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), inArray(jobs.status, ['queued', 'running']))).get();
  if (active) throw new Error(t(lang, 'error.activeJobWait'));
  if (!listSegments(db, scr.id).some((s) => s.status === 'done')) throw new Error(t(lang, 'error.noProducedSegmentsToStitch'));
  const st = await stitchChapter(db, chapterId, scr.id, lang);
  updateChapter(db, chapterId, { status: 'done' });
  return st;
}

// Segment kaydet + cache satırı + segment durumu (tek yerde).
async function saveSegmentAudio(db: Db, segmentRowId: string, hash: string, audio: Buffer, durationMs: number, usd: number): Promise<void> {
  const rel = `segments/${hash}.wav`;
  await mkdir(join(audioDir(), 'segments'), { recursive: true });
  await writeFile(join(audioDir(), rel), audio);
  db.insert(audioCache).values({ hash, path: rel, durationMs, usd, createdAt: Date.now() })
    .onConflictDoUpdate({ target: audioCache.hash, set: { path: rel, durationMs, usd } }).run();
  db.update(segments).set({ status: 'done', error: null, audioPath: rel, contentHash: hash, updatedAt: Date.now() })
    .where(eq(segments.id, segmentRowId)).run();
}

// KN1: preview TTS bazen metni tekrarlayıp uzun sessizlik üretir (saha: 34 karakter → 14 sn).
// Süre, makul tavanı aşarsa 1 kez yeniden dener ve KISA sonucu kullanır. attempts, defter
// dürüstlüğü için döner (her deneme gerçek bir API çağrısıdır). Deneme patlarsa ilk sonuç kalır.
export const DURATION_GUARD_MS_PER_CHAR = 250;
export const DURATION_GUARD_MIN_MS = 4000;
export async function synthesizeChecked(adapter: TtsAdapter, req: TtsSegmentRequest): Promise<{ result: TtsResult; attempts: number }> {
  const maxMs = Math.max(DURATION_GUARD_MIN_MS, req.text.length * DURATION_GUARD_MS_PER_CHAR);
  const first = await adapter.synthesize(req);
  if (first.durationMs <= maxMs) return { result: first, attempts: 1 };
  let second: TtsResult | undefined;
  try { second = await adapter.synthesize(req); } catch { /* bekçi denemesi patladı — ilk sonuç kullanılır */ }
  return { result: second && second.durationMs < first.durationMs ? second : first, attempts: 2 };
}

export async function runJob(db: Db, jobId: string, adapter: TtsAdapter): Promise<void> {
  // KN2: işi atomik sahiplen — aynı queued işi ikinci bir worker alamaz (dev'de rota-başına
  // modül örneği ensureWorker tekilliğini kırabiliyordu; kota 2x yanıyordu).
  const claimed = db.update(jobs).set({ status: 'running', pausedReason: null, updatedAt: Date.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued'))).run();
  if (claimed.changes === 0) return;
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
  const { name: provider, model } = activeProvider(db);
  try {
    const { script, plan } = planChapter(db, job.chapterId, job.scriptId);
    const rows = listSegments(db, job.scriptId);
    let callsUsed = job.callsUsed;
    let doneCount = rows.filter((r) => r.status === 'done').length;
    for (const row of rows) {
      // Dışarıdan iptal edildiyse (yeni enqueue) kota harcamayı bırak; işi olduğu gibi bırak.
      const fresh = db.select().from(jobs).where(eq(jobs.id, job.id)).get();
      if (!fresh || fresh.status !== 'running') return;
      if (row.status === 'done') continue;
      const item = plan[row.idx];
      const cached = db.select().from(audioCache).where(eq(audioCache.hash, item.hash)).get();
      if (cached) { // cache isabeti: çağrı YOK, deftere yazılmaz
        db.update(segments).set({ status: 'done', error: null, audioPath: cached.path, contentHash: item.hash, updatedAt: Date.now() })
          .where(eq(segments.id, row.id)).run();
        setJob(db, job.id, { doneCount: ++doneCount });
        continue;
      }
      if (job.limitCalls != null && callsUsed >= job.limitCalls) {
        setJob(db, job.id, { status: 'queued', pausedReason: 'limit', callsUsed, doneCount });
        return;
      }
      const rem = remainingToday(db, provider);
      if (rem != null && rem <= 0) {
        setJob(db, job.id, { status: 'queued', pausedReason: 'quota', callsUsed, doneCount });
        return;
      }
      try {
        const { result: res, attempts } = await synthesizeChecked(adapter, {
          text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
          style: item.style, tags: item.tags, pronunciations: script.pronunciations,
        });
        callsUsed += attempts;
        // Her deneme deftere yazılır; usd yalnız kullanılan sonuca (bekçi denemesi 0 ile kaydedilir).
        for (let a = 0; a < attempts; a++)
          recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: a === attempts - 1 ? res.cost.usd ?? 0 : 0 });
        await saveSegmentAudio(db, row.id, item.hash, res.audio, res.durationMs, res.cost.usd ?? 0);
        setJob(db, job.id, { callsUsed, doneCount: ++doneCount });
      } catch (e) {
        callsUsed++;
        recordCall(db, { provider, model, segmentId: row.id, ok: false });
        db.update(segments).set({ status: 'failed', error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() })
          .where(eq(segments.id, row.id)).run();
        setJob(db, job.id, { callsUsed });
      }
    }
    // KN3: worker'ın req bağlamı yok; iş dili şemada saklanmadığından burada varsayılan 'tr' kullanılır
    // (bkz. docs/superpowers/plans/2026-07-20-panel-i18n.md Task 8 — bilinen sınır, şema değişikliği gerektirir).
    if (listSegments(db, job.scriptId).every((r) => r.status !== 'done')) throw new Error(t('tr', 'job.noSegmentsProduced'));
    setJob(db, job.id, { status: 'done', doneCount });
    updateChapter(db, job.chapterId, { status: 'voiced' });
  } catch (e) {
    setJob(db, job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    updateChapter(db, job.chapterId, { status: 'error' });
  }
}

// Duraklamış işi sürdürülebilir yapar: kullanıcı bilinçli devam etti → tavan kalkar.
export function resumeJob(db: Db, jobId: string, lang: Lang = 'tr'): JobRow {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error(t(lang, 'job.jobNotFound'));
  if (job.status !== 'queued') throw new Error(t(lang, 'job.notPaused'));
  db.update(jobs).set({ limitCalls: null, pausedReason: null, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
}

// Çökmüş süreçten kalan 'running' işleri kuyruğa geri düşürür.
export function recoverJobs(db: Db): void {
  db.update(jobs).set({ status: 'queued', updatedAt: Date.now() }).where(eq(jobs.status, 'running')).run();
}

// Süreç-içi tek worker: kuyruktaki (duraklamamış) işleri sırayla yürütür.
// globalThis çapası: Next dev'de her rota ayrı modül örneği yükleyebilir; modül-global
// tekilliği bu yüzden yetmez (KN2). Zaten çalışıyorsa AYNI koşunun promise'ine katılır.
const G = globalThis as unknown as { __wntWorker?: Promise<void> | null };
export function ensureWorker(db: Db): Promise<void> {
  if (G.__wntWorker) return G.__wntWorker;
  G.__wntWorker = (async () => {
    await Promise.resolve(); // dış atama tamamlanmadan iç mantık başlamasın — yoksa kuyrukta iş bulunamayınca
    // (hiç await'e uğramadan) fonksiyon senkron biter; finally'deki sıfırlama, dıştaki atamadan ÖNCE
    // çalışıp hemen ezilir ve workerPromise sonsuza dek "ölü" bir promise'e saplanır (bir sonraki
    // ensureWorker çağrısı o promise'e katılır ve HİÇBİR İŞ YAPMADAN anında döner).
    try {
      recoverJobs(db);
      for (;;) {
        const next = db.select().from(jobs)
          .where(and(eq(jobs.status, 'queued'), isNull(jobs.pausedReason)))
          .orderBy(asc(jobs.createdAt)).limit(1).get();
        if (!next) break;
        await runJob(db, next.id, adapterFromSettings(db));
      }
    } finally {
      G.__wntWorker = null;
    }
  })();
  return G.__wntWorker;
}

// Tek segmenti yeniden üretir (cache'i üzerine yazar). Birleştirme ayrı bir adımdır (stitchLatest).
export async function regenerateSegment(db: Db, segmentId: string, adapter: TtsAdapter, lang: Lang = 'tr'): Promise<{ segmentId: string; status: string }> {
  const row = db.select().from(segments).where(eq(segments.id, segmentId)).get();
  if (!row) throw new Error(t(lang, 'error.segmentNotFound'));
  const active = db.select().from(jobs)
    .where(and(eq(jobs.chapterId, row.chapterId), inArray(jobs.status, ['queued', 'running']))).get();
  if (active) throw new Error(t(lang, 'error.activeJobCancelFirst'));
  const { name: provider, model } = activeProvider(db);
  const rem = remainingToday(db, provider);
  if (rem != null && rem <= 0) throw new Error(t(lang, 'error.dailyQuotaReached'));
  const { script, plan } = planChapter(db, row.chapterId, row.scriptId, lang);
  const item = plan[row.idx];
  try {
    const { result: res, attempts } = await synthesizeChecked(adapter, {
      text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
      style: item.style, tags: item.tags, pronunciations: script.pronunciations,
    });
    for (let a = 0; a < attempts; a++)
      recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: a === attempts - 1 ? res.cost.usd ?? 0 : 0 });
    await saveSegmentAudio(db, row.id, item.hash, res.audio, res.durationMs, res.cost.usd ?? 0);
  } catch (e) {
    recordCall(db, { provider, model, segmentId: row.id, ok: false });
    throw new Error(t(lang, 'error.segmentGenerationFailed', { message: e instanceof Error ? e.message : String(e) }));
  }
  // Birleştirme kullanıcının elinde; mevcut mp3 bayatladıysa bölüm voiced'a döner.
  if (getChapter(db, row.chapterId)?.status === 'done') updateChapter(db, row.chapterId, { status: 'voiced' });
  return { segmentId: row.id, status: 'done' };
}
