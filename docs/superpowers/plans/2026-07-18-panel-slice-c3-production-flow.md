# Dilim C3 — Üretim Akışı İyileştirmeleri Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saha bulgularını kapatmak: narrator modunda az-segment (prompt + mergeSegments), worker tekilliği (kota 2x bug'ı), TTS süre bekçisi (model tekrar arızası), script/segment düzenleme, ayrı "Birleştir" adımı (`voiced` durumu).

**Architecture:** Tüm değişiklikler panel katmanında (`lib/`, `app/`) — `src/core` bu dilimde HİÇ değişmez. `mergeSegments` saf fonksiyon olarak annotation'a; worker tekilliği `globalThis` çapası + DB'de atomik iş sahiplenme; süre bekçisi `synthesizeChecked` sarmalayıcısı; stitch, `runJob`'dan çıkarılıp `stitchLatest` servisine ve yeni `POST /api/chapters/[id]/stitch` rotasına taşınır; segment düzenleme `editSegment` (yeni script versiyonu) + `PATCH /api/segments/[id]`.

**Tech Stack:** Next.js 15, Drizzle + better-sqlite3, vitest (ağsız), saf CSS token sistemi.

**Spec:** `docs/superpowers/specs/2026-07-18-panel-slice-c3-production-flow-design.md`

## Global Constraints

- Tüm UI metinleri ve hata mesajları **Türkçe**; Türkçe karakterler birebir korunur, ASCII'ye düzleştirme YASAK.
- `src/core/**` bu dilimde DEĞİŞMEZ (süre bekçisi panel katmanında; CLI etkilenmez).
- `lib/llm/prompt.ts`'teki `'tek anlatıcı'` ve `'çok karakterli'` işaret metinleri MockLlmAdapter'ın mod algısıdır — bu ifadeler AYNEN korunur.
- Sabitler: `MERGE_MAX_CHARS = 700` · `DURATION_GUARD_MS_PER_CHAR = 250` · `DURATION_GUARD_MIN_MS = 4000`.
- Yeni bölüm durumu: `voiced` (segmentler hazır, birleşik mp3 yok). Akış: `draft → scripted → generating → voiced → done`.
- Bilinçli sözleşme değişiklikleri (C1'den sapma, spec ile belgeli): `runJob` sonunda stitch YOK; SSE `done` olayı `renderId` taşımaz; `regenerateSegment` `{ segmentId, status }` döner. İlgili mevcut testler güncellenir — davranış sözleşmesinin kendisi değişiyor.
- Her task sonunda `npx tsc --noEmit` temiz + tam `npm test` yeşil (başlangıç: 34 dosya / 166 test); UI task'ında ek olarak `npm run build`.
- Commit mesajları Türkçe; gövde sonu: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: mergeSegments + narrator prompt kuralları

**Files:**
- Modify: `lib/llm/prompt.ts:14-29`
- Modify: `lib/services/annotation.ts` (mergeSegments + kullanım; satır ~104-121 bölgesi)
- Test: `tests/panel/annotation.test.ts` (ekleme), `tests/panel/llm-base.test.ts` veya prompt testlerinin bulunduğu dosya (grep `buildSystemPrompt` ile bul; yoksa annotation.test.ts'e ekle)

**Interfaces:**
- Produces: `mergeSegments<T extends { speaker: string; type: string; text: string; style?: string; pause_after_ms?: number }>(segs: T[], maxLen?: number): T[]` ve `MERGE_MAX_CHARS = 700` (`lib/services/annotation.ts`'ten export).

- [ ] **Step 1: Failing testleri yaz** — `tests/panel/annotation.test.ts`'e ekle (import satırına `mergeSegments, MERGE_MAX_CHARS` ekle):

```ts
describe('mergeSegments', () => {
  const seg = (text: string, over: Partial<{ speaker: string; type: string; style?: string; pause_after_ms?: number }> = {}) =>
    ({ speaker: 'narrator', type: 'narration', text, ...over });

  test('art arda aynı konuşmacı+stil birleşir; id sırası korunur', () => {
    const out = mergeSegments([seg('Bir.'), seg('İki.'), seg('Üç.')]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Bir. İki. Üç.');
  });
  test('stil farkı birleşmeyi keser (boş vs dolu dahil)', () => {
    const out = mergeSegments([seg('A.'), seg('B.', { style: 'gergin' }), seg('C.', { style: 'gergin' })]);
    expect(out.map((s) => s.text)).toEqual(['A.', 'B. C.']);
  });
  test('konuşmacı farkı birleşmeyi keser (multi korunur)', () => {
    const out = mergeSegments([seg('A.'), seg('B.', { speaker: 'kaan' }), seg('C.', { speaker: 'kaan' })]);
    expect(out.map((s) => s.text)).toEqual(['A.', 'B. C.']);
  });
  test('pause SINIRDIR: pause taşıyan segmentin üstüne eklenmez; birleşende pause son parçanınki', () => {
    const out = mergeSegments([seg('A.', { pause_after_ms: 300 }), seg('B.'), seg('C.', { pause_after_ms: 500 })]);
    expect(out.map((s) => s.text)).toEqual(['A.', 'B. C.']);
    expect(out[0].pause_after_ms).toBe(300);
    expect(out[1].pause_after_ms).toBe(500);
  });
  test('700 karakter tavanı aşılmaz; type ilk parçanınki', () => {
    const a = seg('x'.repeat(680)); const b = seg('y'.repeat(30));
    expect(mergeSegments([a, b])).toHaveLength(2);
    const out = mergeSegments([seg('Soru?', { type: 'dialogue' }), seg('Cevap.')]);
    expect(out[0].type).toBe('dialogue');
  });
  test('girdiyi mutasyona uğratmaz', () => {
    const input = [seg('A.'), seg('B.')];
    mergeSegments(input);
    expect(input[0].text).toBe('A.');
  });
});

describe('annotateChapter + mergeSegments entegrasyonu', () => {
  test('narrator modunda ardışık stilsiz LLM segmentleri tek segmente iner', async () => {
    // kurulum: dosyadaki mevcut yardımcıyla bölüm oluştur (voiceMode narrator, rawText dolu)
    const fake: LlmAdapter = {
      id: 'fake',
      async annotate() {
        return {
          json: {
            cast: [], segments: [
              { speaker: 'narrator', type: 'narration', text: 'Bir cümle.' },
              { speaker: 'narrator', type: 'narration', text: 'İki cümle.' },
              { speaker: 'ali', type: 'dialogue', text: 'Merhaba dedi.' }, // cast dışı → narrator'a düşer → o da birleşir
            ], pronunciations: [],
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const out = await annotateChapter(db, chapterId, fake);
    expect(out.segmentCount).toBe(1);
    const script = JSON.parse(latestScript(db, chapterId)!.json);
    expect(script.segments[0].text).toBe('Bir cümle. İki cümle. Merhaba dedi.');
    expect(script.segments[0].id).toBe('s1');
  });
});
```

(Fake adapter'ı dosyanın mevcut `LlmAdapter` importu ve kurulum yardımcılarıyla uyumla; sözleşme: cast-dışı konuşmacı normalize edildikten SONRA birleşme.)

Prompt testleri (buildSystemPrompt testlerinin olduğu dosyaya; yoksa `tests/panel/llm-base.test.ts`'e ekle):

```ts
test('narrator modunda paragraf-bazlı segment kuralı + kişi taklidi yasağı; 1-3 cümle kuralı YOK', () => {
  const p = buildSystemPrompt({ voiceMode: 'narrator', maxCharacters: 6 });
  expect(p).toContain('tek anlatıcı'); // mock marker korunur
  expect(p).toContain('paragraf bazlı, 3-6 cümle');
  expect(p).toContain('kişi taklidi tarifleri');
  expect(p).not.toContain('1-3 cümle');
});
test('multi modunda 1-3 cümle kuralı durur', () => {
  const p = buildSystemPrompt({ voiceMode: 'multi', maxCharacters: 6 });
  expect(p).toContain('çok karakterli'); // mock marker korunur
  expect(p).toContain('1-3 cümle');
});
```

- [ ] **Step 2: Çalıştır, FAIL doğrula** — `npm test -- tests/panel/annotation.test.ts tests/panel/llm-base.test.ts`.

- [ ] **Step 3: prompt.ts'i güncelle** — `parts` başlangıç dizisinden `'- Segmentler kısa: 1-3 cümle, tek konuşan, tek duygu.'` satırını ÇIKAR; mod bloklarını şöyle yap (işaret metinleri aynen):

```ts
  if (o.voiceMode === 'narrator') {
    parts.push('- Segmentler paragraf bazlı, 3-6 cümle. Kısa diyalogları çevresindeki anlatımla AYNI segmentte tut.');
    parts.push('- SES MODU: tek anlatıcı. TÜM segmentlerde speaker "narrator"; cast yalnızca narrator içerir. Diyaloglar da anlatıcı tarafından akış içinde okunur.');
    parts.push('- style alanını YALNIZ belirgin duygu/tempo değişiminde doldur; kişi taklidi tarifleri ("kadın sesiyle", "çocuk gibi" vb.) YASAK — anlatıcı tek tondadır.');
  } else {
    parts.push('- Segmentler kısa: 1-3 cümle, tek konuşan, tek duygu.');
    parts.push(`- SES MODU: çok karakterli. Konuşan karakterleri tespit et, cast'e ekle (character_id: küçük harf ascii). EN FAZLA ${o.maxCharacters} karakter; önemsiz konuşmalar "narrator"da kalır. Anlatım her zaman "narrator".`);
    parts.push('- Her karakter için gender (male|female|unknown), age_hint (child|young|adult|elder) ve kısa persona doldur.');
  }
```

- [ ] **Step 4: annotation.ts'e mergeSegments ekle ve bağla** — dosyaya export edilen saf fonksiyon:

```ts
export const MERGE_MAX_CHARS = 700;

// Ardışık segmentleri birleştirir (aynı speaker + aynı stil, arada pause yok, tavan aşılmıyor).
// Segment = 1 TTS çağrısı: birleşme doğrudan kota tasarrufudur (saha bulgusu A, spec §1.2).
export function mergeSegments<T extends { speaker: string; type: string; text: string; style?: string; pause_after_ms?: number }>(
  segs: T[], maxLen = MERGE_MAX_CHARS,
): T[] {
  const out: T[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (
      prev && prev.speaker === s.speaker && (prev.style ?? '') === (s.style ?? '') &&
      prev.pause_after_ms == null && prev.text.length + 1 + s.text.length <= maxLen
    ) {
      prev.text = `${prev.text} ${s.text}`;
      prev.pause_after_ms = s.pause_after_ms; // son parçanınki; type ilk parçanınki (değişmez)
      continue;
    }
    out.push({ ...s });
  }
  return out;
}
```

`annotateChapter` içindeki mevcut `const segs = allSegments.map((s, i) => ({ id: \`s${i + 1}\`, ... }))` bloğunu şu üçlüyle DEĞİŞTİR (önce konuşmacı normalize edilir ki cast-dışı → narrator düşüşü birleşmeye dahil olsun; id'ler birleşme SONRASI atanır):

```ts
  const castIds = new Set(cast.map((c) => c.character_id));
  const normalized = allSegments.map((s) => ({
    // narrator modunda veya cast dışı konuşmacıda anlatıcıya düşür (dayanıklılık).
    speaker: voiceMode === 'narrator' || !castIds.has(s.speaker) ? 'narrator' : s.speaker,
    type: s.type, text: s.text, style: s.style, pause_after_ms: s.pause_after_ms,
  }));
  const segs = mergeSegments(normalized).map((s, i) => ({ id: `s${i + 1}`, ...s }));
```

- [ ] **Step 5: Testler + tam suite + tsc** — hepsi yeşil/temiz. Mevcut annotation testlerinde segment sayısı beklentisi mock çıktısına göre değişmiş olabilir — mock'un ürettiği segmentler birleşme koşulunu sağlıyorsa beklentiyi YENİ doğru değere güncelle ve raporda not et (davranış bilinçli değişti).

- [ ] **Step 6: Commit** — `git add lib/llm/prompt.ts lib/services/annotation.ts tests/panel/` → `feat(panel): narrator modunda az-segment — paragraf kuralı + mergeSegments (kota tasarrufu)`

---

### Task 2: KN2 — worker tekilliği (globalThis + atomik iş sahiplenme)

**Files:**
- Modify: `lib/services/producer.ts:80-83` (runJob girişi) ve `:152-177` (ensureWorker)
- Test: `tests/panel/producer.test.ts` (ekleme)

**Interfaces:**
- Produces: davranış garantisi — aynı `queued` işi yalnız BİR yürütücü sahiplenir; `ensureWorker` süreçte tek promise (`globalThis.__wntWorker`).

- [ ] **Step 1: Failing test yaz** — `tests/panel/producer.test.ts`'e ekle (dosyanın mevcut kurulum/sayaç-adapter kalıbını kullan):

```ts
test('aynı işe eşzamanlı iki runJob: yalnız biri sahiplenir, çağrı sayısı segment sayısını aşmaz', async () => {
  const { db, chapterId } = setup(); // mevcut yardımcı; script 5 segmentli fixture
  let calls = 0;
  const spy = { id: 'mock', async synthesize(req: TtsSegmentRequest) { calls++; return new MockAdapter().synthesize(req); } };
  const job = enqueueJob(db, chapterId);
  await Promise.all([runJob(db, job.id, spy), runJob(db, job.id, spy)]);
  expect(calls).toBe(5); // çift worker olsaydı 10'a çıkardı (KN2 saha bulgusu)
  const fresh = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
  expect(fresh.status).toBe('done');
});
```

- [ ] **Step 2: FAIL doğrula** — mevcut kodda iki çağrı da `status: 'running'` yazıp yürür → calls 10 olur.

- [ ] **Step 3: runJob girişini atomik sahiplenmeye çevir** — mevcut:

```ts
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
  setJob(db, job.id, { status: 'running', pausedReason: null });
```

YENİ:

```ts
  // KN2: işi atomik sahiplen — aynı queued işi ikinci bir worker alamaz (dev'de rota-başına
  // modül örneği ensureWorker tekilliğini kırabiliyordu; kota 2x yanıyordu).
  const claimed = db.update(jobs).set({ status: 'running', pausedReason: null, updatedAt: Date.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued'))).run();
  if (claimed.changes === 0) return;
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
```

(`and`/`eq` importları dosyada mevcut. Not: `running` durumdaki işe yeniden giriş de böylece engellenir; çökme telafisi `recoverJobs`'ta — davranış korunur.)

- [ ] **Step 4: ensureWorker'ı globalThis'e taşı** — modül-global `let workerPromise` satırını sil; fonksiyonu şu hale getir (İÇERİDEKİ mevcut uzun açıklama yorumunu ve `await Promise.resolve()` satırını AYNEN koru):

```ts
// Süreç-içi tek worker: kuyruktaki (duraklamamış) işleri sırayla yürütür.
// globalThis çapası: Next dev'de her rota ayrı modül örneği yükleyebilir; modül-global
// tekilliği bu yüzden yetmez (KN2). Zaten çalışıyorsa AYNI koşunun promise'ine katılır.
const G = globalThis as unknown as { __wntWorker?: Promise<void> | null };
export function ensureWorker(db: Db): Promise<void> {
  if (G.__wntWorker) return G.__wntWorker;
  G.__wntWorker = (async () => {
    await Promise.resolve(); // (mevcut zehirli-singleton açıklama yorumu buraya taşınır — silme)
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
```

- [ ] **Step 5: Testler + tam suite + tsc** — yeni test yeşil; mevcut zehirli-singleton regresyon testi ve resume testleri de yeşil kalmalı.

- [ ] **Step 6: Commit** — `fix(panel): worker tekilliği — globalThis çapası + atomik iş sahiplenme (kota 2x bug'ı)`

---

### Task 3: KN1 — süre bekçisi (synthesizeChecked)

**Files:**
- Modify: `lib/services/producer.ts` (yeni yardımcı + runJob/regenerateSegment bağlanması)
- Test: `tests/panel/producer.test.ts` (ekleme)

**Interfaces:**
- Produces: `synthesizeChecked(adapter: TtsAdapter, req: TtsSegmentRequest): Promise<{ result: TtsResult; attempts: number }>` + sabitler `DURATION_GUARD_MS_PER_CHAR = 250`, `DURATION_GUARD_MIN_MS = 4000` (producer.ts'ten export).

- [ ] **Step 1: Failing testleri yaz** — `tests/panel/producer.test.ts`:

```ts
describe('synthesizeChecked (KN1 süre bekçisi)', () => {
  const req = { text: 'Kısa bir cümle.', voice: { provider: 'mock', providerVoice: 'x' }, language: 'tr-TR' };
  const fake = (durations: number[], failFrom = Infinity): TtsAdapter => {
    let i = 0;
    return { id: 'fake', async synthesize() {
      if (i >= failFrom) { i++; throw new Error('deneme patladı'); }
      const d = durations[Math.min(i++, durations.length - 1)];
      return { audio: Buffer.alloc(4), format: 'wav' as const, durationMs: d, cost: { unit: 'chars' as const, amount: 5, usd: 0 } };
    } };
  };
  test('makul süre: tek deneme', async () => {
    const { result, attempts } = await synthesizeChecked(fake([2000]), req);
    expect(attempts).toBe(1);
    expect(result.durationMs).toBe(2000);
  });
  test('absürt süre: 1 yeniden deneme, kısa sonuç seçilir', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000, 2200]), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(2200);
  });
  test('iki deneme de absürtse kısa olan kullanılır', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000, 20000]), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(14000);
  });
  test('yeniden deneme patlarsa ilk sonuç kullanılır (başarı bozulmaz)', async () => {
    const { result, attempts } = await synthesizeChecked(fake([14000], 1), req);
    expect(attempts).toBe(2);
    expect(result.durationMs).toBe(14000);
  });
  test('eşik: max(4000, uzunluk*250)', async () => {
    // 15 karakter → tavan 4000 (taban); 4000 üstü tetikler, altı tetiklemez
    const { attempts } = await synthesizeChecked(fake([3900]), req);
    expect(attempts).toBe(1);
  });
});

test('runJob bekçi denemelerini deftere yazar (attempts kadar kayıt + callsUsed)', async () => {
  const { db, chapterId } = setup();
  setSetting(db, 'provider', 'mock');
  // ilk segmentte absürt, sonra normal süre veren adapter
  let n = 0;
  const spy: TtsAdapter = { id: 'mock', async synthesize(req) {
    const base = await new MockAdapter().synthesize(req);
    n++;
    return n === 1 ? { ...base, durationMs: 999999 } : base;
  } };
  const job = enqueueJob(db, chapterId);
  await runJob(db, job.id, spy);
  const calls = db.select().from(ttsCalls).all();
  expect(calls.length).toBe(6); // 5 segment + 1 bekçi denemesi
  const fresh = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
  expect(fresh.callsUsed).toBe(6);
});
```

- [ ] **Step 2: FAIL doğrula.**

- [ ] **Step 3: producer.ts'e yardımcıyı ekle** (import'lara `TtsResult`, `TtsSegmentRequest` tipleri eklenir):

```ts
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
```

- [ ] **Step 4: runJob ve regenerateSegment'i bağla** — `runJob` içindeki try bloğunda mevcut `const res = await adapter.synthesize({...}); callsUsed++; recordCall(...);` üçlüsünü şu yapıyla değiştir:

```ts
        const { result: res, attempts } = await synthesizeChecked(adapter, {
          text: item.text, voice: parseVoiceId(item.voiceId), language: script.language,
          style: item.style, tags: item.tags, pronunciations: script.pronunciations,
        });
        callsUsed += attempts;
        // Her deneme deftere yazılır; usd yalnız kullanılan sonuca (bekçi denemesi 0 ile kaydedilir).
        for (let a = 0; a < attempts; a++)
          recordCall(db, { provider, model, segmentId: row.id, ok: true, usd: a === attempts - 1 ? res.cost.usd ?? 0 : 0 });
```

`regenerateSegment` içindeki `const res = await adapter.synthesize({...}); recordCall(...)` bloğu da aynı kalıba geçer (attempts döngüsüyle kayıt). Hata yolu (catch → ok:false tek kayıt) her iki yerde AYNEN kalır.

- [ ] **Step 5: Testler + tam suite + tsc.** (Not: mevcut producer testlerinde çağrı sayısı beklentileri MockAdapter'ın makul süreleriyle değişmez — bekçi tetiklenmez.)

- [ ] **Step 6: Commit** — `fix(panel): TTS süre bekçisi — absürt süreli çıktıda 1 yeniden deneme, kısa sonuç (KN1)`

---

### Task 4: D — stitch'i ayrıştır (voiced durumu + stitchLatest + SSE sözleşmesi)

**Files:**
- Modify: `lib/services/producer.ts` (runJob sonu, regenerateSegment, yeni stitchLatest)
- Modify: `lib/db/schema.ts:26` (yalnız yorum: `draft|scripted|generating|voiced|done|error`)
- Create: `app/api/chapters/[id]/stitch/route.ts`
- Modify: `app/api/chapters/[id]/progress/route.ts:29-32`
- Test: `tests/panel/producer.test.ts`, `tests/panel/regenerate.test.ts`, `tests/panel/api-generate.test.ts` (güncelleme + ekleme)

**Interfaces:**
- Consumes: mevcut `stitchChapter`, `latestScript`, `listSegments`, `updateChapter`.
- Produces: `stitchLatest(db: Db, chapterId: string): Promise<{ renderId: string; renderPath: string; durationSec: number }>` · `regenerateSegment` artık `{ segmentId: string; status: string }` döner · SSE `done` olayı `{ jobId, done, total, status, failedCount }` (renderId YOK) · bölüm durumu `voiced`.

- [ ] **Step 1: Failing/güncellenen testleri yaz:**

`tests/panel/producer.test.ts` — runJob-sonu beklentilerini değiştir + stitchLatest testleri ekle:

```ts
test('runJob sonunda render YOK; bölüm voiced olur', async () => {
  const { db, chapterId } = setup();
  const job = enqueueJob(db, chapterId);
  await runJob(db, job.id, new MockAdapter());
  expect(db.select().from(renders).all()).toHaveLength(0);
  expect(getChapter(db, chapterId)!.status).toBe('voiced');
});

describe('stitchLatest', () => {
  test('done segmentlerden render üretir; bölüm done olur', async () => {
    const { db, chapterId } = setup();
    const job = enqueueJob(db, chapterId);
    await runJob(db, job.id, new MockAdapter());
    const st = await stitchLatest(db, chapterId);
    expect(st.renderId).toMatch(/^rnd_/);
    expect(db.select().from(renders).all()).toHaveLength(1);
    expect(getChapter(db, chapterId)!.status).toBe('done');
  });
  test('aktif iş varken Türkçe hata', async () => {
    const { db, chapterId } = setup();
    enqueueJob(db, chapterId); // queued bırak
    await expect(stitchLatest(db, chapterId)).rejects.toThrow(/aktif bir üretim işi/);
  });
  test('hiç done segment yoksa Türkçe hata', async () => {
    const { db, chapterId } = setup(); // script var, üretim yok
    await expect(stitchLatest(db, chapterId)).rejects.toThrow(/üretilmiş segment yok/);
  });
});
```

`tests/panel/regenerate.test.ts` — dönüş/render beklentilerini değiştir:

```ts
test('regen render ÜRETMEZ, {segmentId,status} döner; done bölüm voiced\'a düşer', async () => {
  // mevcut kurulum: üret + stitchLatest ile done'a getir
  const out = await regenerateSegment(db, segId, new MockAdapter());
  expect(out).toEqual({ segmentId: segId, status: 'done' });
  expect(db.select().from(renders).all()).toHaveLength(1); // stitchLatest'inki; yenisi YOK
  expect(getChapter(db, chapterId)!.status).toBe('voiced');
});
```

`tests/panel/api-generate.test.ts` — SSE `done` olayı: `renderId` alanı beklentisini kaldır, `failedCount` kalır; yeni stitch rotası testi ekle:

```ts
test('POST /api/chapters/[id]/stitch: render döner; aktif işte 400', async () => {
  // üretimi mock ile bitir (mevcut akış yardımcıları), sonra:
  const ok = await stitchRoute.POST(jsonReq('POST'), ctx(chapterId));
  expect(ok.status).toBe(200);
  expect((await ok.json()).renderId).toMatch(/^rnd_/);
});
```

- [ ] **Step 2: FAIL doğrula** (özellikle runJob-sonu render beklentisi eski kodda kırılmalı).

- [ ] **Step 3: producer.ts değişiklikleri:**

runJob sonundaki mevcut:

```ts
    await stitchChapter(db, job.chapterId, job.scriptId);
    setJob(db, job.id, { status: 'done', doneCount });
    updateChapter(db, job.chapterId, { status: 'done' });
```

YENİ (spec §3: stitch artık ayrı adım):

```ts
    if (listSegments(db, job.scriptId).every((r) => r.status !== 'done')) throw new Error('Hiç segment üretilemedi');
    setJob(db, job.id, { status: 'done', doneCount });
    updateChapter(db, job.chapterId, { status: 'voiced' });
```

Yeni servis fonksiyonu (stitchChapter'ın altına):

```ts
// Birleştirme artık bilinçli bir adım: en güncel script'in done segmentlerinden mp3 üretir.
export async function stitchLatest(db: Db, chapterId: string): Promise<{ renderId: string; renderPath: string; durationSec: number }> {
  const scr = latestScript(db, chapterId);
  if (!scr) throw new Error('Bölümün script’i yok — önce script üretin');
  const active = db.select().from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), inArray(jobs.status, ['queued', 'running']))).get();
  if (active) throw new Error('Bölümde aktif bir üretim işi var — bitmesini bekleyin');
  if (!listSegments(db, scr.id).some((s) => s.status === 'done')) throw new Error('Birleştirilecek üretilmiş segment yok');
  const st = await stitchChapter(db, chapterId, scr.id);
  updateChapter(db, chapterId, { status: 'done' });
  return st;
}
```

regenerateSegment sonundaki mevcut:

```ts
  const st = await stitchChapter(db, row.chapterId, row.scriptId);
  return { renderId: st.renderId, renderPath: st.renderPath };
```

YENİ (bayat mp3 kuralı dahil):

```ts
  // Birleştirme kullanıcının elinde; mevcut mp3 bayatladıysa bölüm voiced'a döner.
  if (getChapter(db, row.chapterId)?.status === 'done') updateChapter(db, row.chapterId, { status: 'voiced' });
  return { segmentId: row.id, status: 'done' };
}
```

(`getChapter` importu `./chapters`'tan eklenir; dönüş tipi güncellenir.)

- [ ] **Step 4: API değişiklikleri:**

`app/api/chapters/[id]/stitch/route.ts` (yeni):

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { stitchLatest } from '@/lib/services/producer';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await stitchLatest(getDb(), id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`progress/route.ts` — `done` dalını şu hale getir (`listRenders` importu ve kullanımı SİLİNİR):

```ts
        if (job.status === 'done') {
          const failedCount = listSegments(db, job.scriptId).filter((s) => s.status === 'failed').length;
          send('done', { ...base, failedCount });
        }
```

`schema.ts:26` yorumunu güncelle: `// draft|scripted|generating|voiced|done|error`.

- [ ] **Step 5: Testler + tam suite + tsc** — güncellenen sözleşme testleri dahil hepsi yeşil.

- [ ] **Step 6: Commit** — `feat(panel): birleştirme ayrı adım — voiced durumu, stitchLatest + /stitch rotası, regen stitch yapmaz`

---

### Task 5: editSegment servisi + PATCH /api/segments/[id] + GET script JSON

**Files:**
- Modify: `lib/services/scripts.ts` (editSegment)
- Create: `app/api/segments/[id]/route.ts` (PATCH)
- Modify: `app/api/chapters/[id]/script/route.ts` (GET eklenir — mevcut PUT korunur)
- Test: `tests/panel/edit-segment.test.ts` (yeni)

**Interfaces:**
- Produces: `editSegment(db: Db, segmentId: string, patch: { text?: string; style?: string | null }): { scriptId: string; version: number }` · `PATCH /api/segments/[id]` gövde `{ text?, style? }` → `{ scriptId, version }` · `GET /api/chapters/[id]/script` → en güncel script JSON'u (yoksa 404).

- [ ] **Step 1: Failing test yaz** — `tests/panel/edit-segment.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, setDbForTests, type Db } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter } from '@/lib/services/chapters';
import { editSegment, importScript, latestScript, listSegments } from '@/lib/services/scripts';
import * as segRoute from '@/app/api/segments/[id]/route';
import * as scriptRoute from '@/app/api/chapters/[id]/script/route';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://p', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

let db: Db, chapterId: string, scriptId: string;
beforeEach(() => {
  db = createDb(':memory:'); setDbForTests(db);
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  chapterId = c.id;
  scriptId = importScript(db, chapterId, FIXTURE).scriptId;
});

describe('editSegment', () => {
  test('yeni versiyon; yalnız hedef segment değişir; stil null silinir', () => {
    const seg = listSegments(db, scriptId)[1];
    const out = editSegment(db, seg.id, { text: 'Yeni metin.', style: null });
    expect(out.version).toBe(2);
    const json = JSON.parse(latestScript(db, chapterId)!.json);
    expect(json.segments[1].text).toBe('Yeni metin.');
    expect(json.segments[1].style).toBeUndefined();
    expect(json.segments[0].text).toBe(JSON.parse(FIXTURE).segments[0].text);
  });
  test('boş metin, olmayan segment ve eski-versiyon segmenti Türkçe hata', () => {
    const seg = listSegments(db, scriptId)[0];
    expect(() => editSegment(db, seg.id, { text: '  ' })).toThrow(/boş olamaz/);
    expect(() => editSegment(db, 'seg_yok', { text: 'x' })).toThrow(/bulunamadı/);
    editSegment(db, seg.id, { text: 'v2 metni' }); // v2 oluştu → eski seg artık güncel değil
    expect(() => editSegment(db, seg.id, { text: 'x' })).toThrow(/güncel script/);
  });
});

describe('rotalar', () => {
  test('PATCH /api/segments/[id] → {scriptId, version}; geçersiz gövde 400', async () => {
    const seg = listSegments(db, scriptId)[0];
    const ok = await segRoute.PATCH(jsonReq('PATCH', { text: 'Düzenlendi.' }), ctx(seg.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);
    const bad = await segRoute.PATCH(jsonReq('PATCH', {}), ctx(seg.id));
    expect(bad.status).toBe(400);
  });
  test('GET /api/chapters/[id]/script → JSON metni; script yoksa 404', async () => {
    const ok = await scriptRoute.GET(jsonReq('GET'), ctx(chapterId));
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text()).segments).toHaveLength(5);
    const p2 = createProject(db, { title: 'X' });
    const c2 = createChapter(db, p2.id, { title: 'Boş' });
    expect((await scriptRoute.GET(jsonReq('GET'), ctx(c2.id))).status).toBe(404);
  });
});
```

- [ ] **Step 2: FAIL doğrula.**

- [ ] **Step 3: scripts.ts'e editSegment ekle** (changeCastVoice'un altına):

```ts
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
```

- [ ] **Step 4: rotaları yaz:**

`app/api/segments/[id]/route.ts` (yeni):

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { editSegment } from '@/lib/services/scripts';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === 'string' ? b.text : undefined;
  const style = typeof b.style === 'string' || b.style === null ? b.style : undefined;
  if (text === undefined && style === undefined) return NextResponse.json({ error: 'text veya style gerekli' }, { status: 400 });
  try {
    return NextResponse.json(editSegment(getDb(), id, { text, style }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`app/api/chapters/[id]/script/route.ts` — dosyaya GET ekle (PUT aynen kalır):

```ts
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scr = latestScript(getDb(), id);
  if (!scr) return NextResponse.json({ error: 'Bölümün script’i yok' }, { status: 404 });
  return new Response(scr.json, { headers: { 'Content-Type': 'application/json' } });
}
```

(`latestScript` importu dosyada yoksa eklenir.)

- [ ] **Step 5: Testler + tam suite + tsc.**

- [ ] **Step 6: Commit** — `feat(panel): segment düzenleme — editSegment + PATCH /api/segments/[id] + GET script JSON`

---

### Task 6: UI — düzenleme akışları, Birleştir düğmesi, voiced rozetleri

**Files:**
- Modify: `app/chapters/[id]/page.tsx`
- Modify: `app/globals.css` (voiced renkleri)
- Test: yok (repo kalıbı: UI birim testi yok) — doğrulama `npx tsc --noEmit` + `npm run build` + tam suite.

**Interfaces:**
- Consumes: Task 4-5 API'leri. Görsel dil: mevcut koyu stüdyo sınıfları; yeni CSS yalnız `voiced` renkleri.

- [ ] **Step 1: globals.css'e voiced renkleri ekle** — `.badge.generating` satırının altına ve `.dot.generating` satırının altına:

```css
.badge.voiced { background: color-mix(in srgb, #2dd4bf 16%, transparent); color: #2dd4bf; }
```
```css
.dot.voiced { background: #2dd4bf; }
```

- [ ] **Step 2: page.tsx — state ve eylemler.** Mevcut state'lerin yanına:

```ts
  const [stitchBusy, setStitchBusy] = useState(false);
  const [editSeg, setEditSeg] = useState<{ id: string; text: string; style: string } | null>(null);
```

Eylem fonksiyonları (`regenerate`'in altına):

```ts
  async function stitch() {
    setStitchBusy(true);
    try {
      const res = await fetch(`/api/chapters/${id}/stitch`, { method: 'POST' });
      if (!res.ok) {
        const err = (await res.json()).error ?? 'Birleştirilemedi';
        setGenState((s) => ({ ...s, err }));
      }
      refreshTree(); load();
    } finally { setStitchBusy(false); }
  }

  async function loadScriptJson() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`);
    if (res.ok) setScriptJson(JSON.stringify(await res.json(), null, 2));
    else setScriptErr('Script yüklenemedi');
  }

  async function saveSegmentEdit() {
    if (!editSeg) return;
    const res = await fetch(`/api/segments/${editSeg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editSeg.text, style: editSeg.style.trim() ? editSeg.style : null }),
    });
    if (!res.ok) {
      const err = (await res.json()).error ?? 'Segment kaydedilemedi';
      setGenState((s) => ({ ...s, err }));
    } else setEditSeg(null);
    refreshTree(); load(); loadPreflight();
  }
```

- [ ] **Step 3: Script kartı — JSON düzenleme.** Mevcut `<details>` bloğunu şu hale getir:

```tsx
        <details>
          <summary>Script JSON (görüntüle / düzenle / elle yapıştır)</summary>
          <p className="row">
            {script && <button className="ghost" onClick={loadScriptJson}><Icon name="doc" /> Mevcut JSON’u getir</button>}
          </p>
          <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder="JSON script’i buraya yapıştır (kaydet = yeni versiyon)" /></p>
          <button className="ghost" onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
        </details>
```

- [ ] **Step 4: Üretim kartı — Birleştir + voiced notları.** `{genState.err && ...}` satırı ile `{renders.map(...)}` arasına:

```tsx
        <p className="row">
          <button onClick={stitch} disabled={stitchBusy || genState.busy || !['voiced', 'done'].includes(chapter.status)}>
            {stitchBusy ? <Icon name="spinner" /> : <Icon name="doc" />} Birleştir (mp3)
          </button>
          {chapter.status === 'voiced' && (
            <span className="muted">
              {renders.length > 0 ? 'Segmentler değişti — son mp3 güncel değil.' : 'Segmentler hazır — dinlemek için birleştir.'}
            </span>
          )}
          {chapter.status === 'voiced' && segments.some((s) => s.status === 'failed') && (
            <span className="muted"><Icon name="warn" size={12} /> {segments.filter((s) => s.status === 'failed').length} segment başarısız — birleştirme yalnız üretilenleri içerir.</span>
          )}
        </p>
```

- [ ] **Step 5: Segment tablosu — satır içi düzenleme.** Metin hücresini (`<td className="mono">{s.text.length > 80 ? ... }</td>`) şu hale getir ve durum hücresindeki ikon grubuna kalem ekle:

```tsx
                  <td className="mono">
                    {editSeg?.id === s.id ? (
                      <span className="rows">
                        <textarea value={editSeg.text} onChange={(e) => setEditSeg({ ...editSeg, text: e.target.value })} rows={3} />
                        <input value={editSeg.style} onChange={(e) => setEditSeg({ ...editSeg, style: e.target.value })} placeholder="stil (boş = stilsiz)" />
                        <span className="row">
                          <button className="ghost" onClick={saveSegmentEdit} disabled={!editSeg.text.trim()}>Kaydet</button>
                          <button className="ghost" onClick={() => setEditSeg(null)}>Vazgeç</button>
                        </span>
                      </span>
                    ) : (
                      s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
                    )}
                  </td>
```

İkon grubuna (yeniden-üret düğmesinin ÖNÜNE):

```tsx
                      <button className="icon" onClick={() => setEditSeg({ id: s.id, text: s.text, style: s.style ?? '' })} disabled={genState.busy || annState.busy || regenBusy !== null} aria-label="Segmenti düzenle" title="Segmenti düzenle"><Icon name="pencil" size={13} /></button>
```

- [ ] **Step 6: Doğrula** — `npx tsc --noEmit` temiz, `npm run build` temiz (dev server kapalıyken), `npm test` tam suite yeşil.

- [ ] **Step 7: Commit** — `feat(panel): UI — script/segment düzenleme, Birleştir adımı, voiced rozetleri`

---

### Task 7: Docs + kapanış

**Files:**
- Modify: `CLAUDE.md` (C3 ✅; kısıt #2'ye KN1 bekçisi, kısıt #1'e KN2 notu; sonraki oturum → Dilim D)
- Modify: `README.md` ("## Durum" listesine C3 ✅; kullanım akışına bir cümle: üretim sonrası "Birleştir")

**Adımlar:**

- [ ] **Step 1: CLAUDE.md güncelle:**
  - "Ne yapıldı" listesinde C3 satırını ✅ yap (spec + plan yolları: `docs/superpowers/plans/2026-07-18-panel-slice-c3-production-flow.md`); Dilim D satırına `SONRAKİ.` ekle.
  - Bilinen kısıt #1'e ekle: `GÜNCELLEME (C3): dev'de çift-worker kota 2x yakma bug'ı kapatıldı (atomik iş sahiplenme).`
  - Bilinen kısıt #2'ye ekle: `GÜNCELLEME (C3): model bazen stilli kısa segmentlerde metni tekrarlayıp uzun sessizlik üretiyor; panel süre bekçisi (250 ms/karakter, min 4 sn) absürt çıktıda 1 kez yeniden deneyip kısa sonucu kullanıyor. Sorun sürerse segment "düzenle/yeniden üret" ile elle çözülür.`
  - "Sonraki oturum için öneri"yi Dilim D brainstorming'i olarak güncelle; `voiced` durumunun D oynatıcısında dikkate alınacağını not et.
- [ ] **Step 2: README "## Durum" listesine C3 satırı ekle (✅, diğerleriyle aynı biçim); kullanım bölümünde üretim akışına "üretim bitince segmentleri dinleyip düzelt, ardından Birleştir (mp3)" cümlesi.**
- [ ] **Step 3: Tam doğrulama** — `npm run build` + `npm test` (beklenen: ~34-35 dosya / ~180+ test yeşil).
- [ ] **Step 4: Commit** — `docs: C3 üretim akışı — CLAUDE.md/README durum ve kısıt güncellemeleri`

---

## Doğrulama (dilim sonu)

1. Tam suite + tsc + build temiz.
2. Kullanıcı görsel onayı (dev server): tek anlatıcı annotate → segment sayısı belirgin az; segment düzenle (kalem) → yalnız 1 yeni çağrı; üretim bitince durum `voiced` + "Birleştir" → mp3; regen sonrası "son mp3 güncel değil" notu.
3. Gerçek Gemini ile kısa bölümde: tts_calls günlüğünde çift kayıt YOK (KN2), absürt süreli segmentte bekçi kaydı görünür (KN1).
