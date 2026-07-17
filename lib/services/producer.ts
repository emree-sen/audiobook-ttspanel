import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { audioCache, jobs, renders, segments } from '../db/schema';
import { newId } from '../id';
import { audioDir } from '../config';
import { updateChapter } from './chapters';
import { latestScript, listSegments } from './scripts';
import { activeProvider, recordCall, remainingToday } from './quota';
import { planChapter } from './preflight';
import { adapterFromSettings } from './generation';
import { parseVoiceId } from '@/src/core/voices';
import { concatSegmentsToWav, wavToMp3 } from '@/src/core/audio/stitch';
import type { TtsAdapter } from '@/src/core/types';

export type JobRow = typeof jobs.$inferSelect;

export function latestJob(db: Db, chapterId: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.chapterId, chapterId)).orderBy(desc(jobs.createdAt)).limit(1).get();
}

function setJob(db: Db, id: string, patch: Partial<JobRow>): void {
  db.update(jobs).set({ ...patch, updatedAt: Date.now() }).where(eq(jobs.id, id)).run();
}

// Bölüm için yeni iş kuyruklar; aktif işi iptal eder, segment durumlarını sıfırlar.
export function enqueueJob(db: Db, chapterId: string, opts?: { limitCalls?: number }): JobRow {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script üretin');
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
export async function stitchChapter(db: Db, chapterId: string, scriptId: string): Promise<{ renderId: string; renderPath: string; durationSec: number }> {
  const { plan } = planChapter(db, chapterId, scriptId);
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
  if (parts.length === 0) throw new Error('Hiç segment üretilemedi');
  const mp3 = await wavToMp3(concatSegmentsToWav(parts));
  const renderId = newId('rnd');
  const relPath = `${chapterId}/${renderId}.mp3`;
  await mkdir(join(audioDir(), chapterId), { recursive: true });
  await writeFile(join(audioDir(), relPath), mp3);
  db.insert(renders).values({ id: renderId, chapterId, scriptId, path: relPath, durationSec: totalMs / 1000, createdAt: Date.now() }).run();
  return { renderId, renderPath: relPath, durationSec: totalMs / 1000 };
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

export async function runJob(db: Db, jobId: string, adapter: TtsAdapter): Promise<void> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
  setJob(db, job.id, { status: 'running', pausedReason: null });
  const { name: provider, model } = activeProvider(db);
  try {
    const { script, plan } = planChapter(db, job.chapterId, job.scriptId);
    const rows = listSegments(db, job.scriptId);
    let callsUsed = job.callsUsed;
    let doneCount = rows.filter((r) => r.status === 'done').length;
    for (const row of rows) {
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
        const res = await adapter.synthesize({
          text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
          style: item.style, tags: item.tags, pronunciations: script.pronunciations,
        });
        callsUsed++;
        recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: res.cost.usd ?? 0 });
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
    await stitchChapter(db, job.chapterId, job.scriptId);
    setJob(db, job.id, { status: 'done', doneCount });
    updateChapter(db, job.chapterId, { status: 'done' });
  } catch (e) {
    setJob(db, job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    updateChapter(db, job.chapterId, { status: 'error' });
  }
}

// Duraklamış işi sürdürülebilir yapar: kullanıcı bilinçli devam etti → tavan kalkar.
export function resumeJob(db: Db, jobId: string): JobRow {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error('İş bulunamadı');
  if (job.status !== 'queued') throw new Error('İş duraklamış değil');
  db.update(jobs).set({ limitCalls: null, pausedReason: null, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
}

// Çökmüş süreçten kalan 'running' işleri kuyruğa geri düşürür.
export function recoverJobs(db: Db): void {
  db.update(jobs).set({ status: 'queued', updatedAt: Date.now() }).where(eq(jobs.status, 'running')).run();
}

// Süreç-içi tek worker: kuyruktaki (duraklamamış) işleri sırayla yürütür.
// Zaten çalışıyorsa AYNI koşunun promise'ini döndürür — await eden, sürmekte olan koşuya katılır
// (testlerde deterministik bekleme; rotalarda void ile ateşle-unut).
let workerPromise: Promise<void> | null = null;
export function ensureWorker(db: Db): Promise<void> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
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
      workerPromise = null;
    }
  })();
  return workerPromise;
}

// Tek segmenti yeniden üretir (cache'i üzerine yazar) ve bölümü yeniden birleştirir.
export async function regenerateSegment(db: Db, segmentId: string, adapter: TtsAdapter): Promise<{ renderId: string; renderPath: string }> {
  const row = db.select().from(segments).where(eq(segments.id, segmentId)).get();
  if (!row) throw new Error('Segment bulunamadı');
  const active = db.select().from(jobs)
    .where(and(eq(jobs.chapterId, row.chapterId), inArray(jobs.status, ['queued', 'running']))).get();
  if (active) throw new Error('Bölümde aktif bir üretim işi var — önce bitmesini/duraklamasını iptal edin');
  const { name: provider, model } = activeProvider(db);
  const rem = remainingToday(db, provider);
  if (rem != null && rem <= 0) throw new Error('Bugünkü kota doldu — yarın tekrar deneyin');
  const { script, plan } = planChapter(db, row.chapterId, row.scriptId);
  const item = plan[row.idx];
  try {
    const res = await adapter.synthesize({
      text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
      style: item.style, tags: item.tags, pronunciations: script.pronunciations,
    });
    recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: res.cost.usd ?? 0 });
    await saveSegmentAudio(db, row.id, item.hash, res.audio, res.durationMs, res.cost.usd ?? 0);
  } catch (e) {
    recordCall(db, { provider, model, segmentId: row.id, ok: false });
    throw new Error(`Segment üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
  }
  const st = await stitchChapter(db, row.chapterId, row.scriptId);
  return { renderId: st.renderId, renderPath: st.renderPath };
}
