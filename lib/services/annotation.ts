import type { Db } from '../db/client';
import { t, type Lang } from '../i18n';
import { getSetting } from './settings';
import { getChapter } from './chapters';
import { latestScript, saveScript } from './scripts';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt';
import { llmChunkSchema, type LlmCast, type LlmChunk } from '../llm/schema';
import { GeminiLlmAdapter } from '../llm/gemini';
import { MockLlmAdapter } from '../llm/mock';
import { OpenAiCompatLlmAdapter } from '../llm/openai';
import type { LlmAdapter } from '../llm/types';
import { loadPool, pickVoice } from '../voices-pool';
import { geminiApiKey } from './generation';
import { activeProvider } from './quota';

export interface AnnotateOutcome {
  scriptId: string; version: number; segmentCount: number; castCount: number;
  usage: { inputTokens: number; outputTokens: number; chunks: number };
}

const CHUNK_TARGET = 12_000; // karakter; Gemini flash çıktı limitine güvenli mesafe

export function llmAdapterFromSettings(db: Db, lang: Lang = 'tr'): LlmAdapter {
  const provider = getSetting(db, 'llm_provider') ?? process.env.LLM_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockLlmAdapter();
  if (provider === 'openai-compat') {
    const baseUrl = getSetting(db, 'llm_base_url') ?? process.env.LLM_BASE_URL;
    if (!baseUrl) throw new Error(t(lang, 'error.llmBaseUrlMissing'));
    const model = getSetting(db, 'llm_model') ?? process.env.LLM_MODEL;
    if (!model) throw new Error(t(lang, 'error.llmModelMissing'));
    return new OpenAiCompatLlmAdapter({ baseUrl, apiKey: getSetting(db, 'llm_api_key') ?? process.env.LLM_API_KEY, model });
  }
  const key = geminiApiKey(db);
  if (!key) throw new Error(t(lang, 'error.geminiKeyMissing'));
  return new GeminiLlmAdapter(key, getSetting(db, 'llm_model') ?? process.env.LLM_MODEL);
}

// Paragraf sınırından ~target karakterlik parçalar; çoğu bölüm tek parça.
export function chunkText(raw: string, target = CHUNK_TARGET, lang: Lang = 'tr'): string[] {
  const text = raw.trim();
  if (!text) throw new Error(t(lang, 'error.chapterTextEmpty'));
  if (text.length <= target) return [text];
  const chunks: string[] = [];
  let cur = '';
  for (const p of text.split(/\n\s*\n/)) {
    if (cur && cur.length + p.length + 2 > target) { chunks.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

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

// Tek chunk: LLM çağrısı + zod doğrulama; hatada 1 retry (hata özeti sistem prompt'a eklenir).
async function annotateChunk(adapter: LlmAdapter, system: string, user: string, lang: Lang = 'tr'): Promise<{ chunk: LlmChunk; usage: { inputTokens: number; outputTokens: number } }> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sys = attempt === 1 ? system : `${system}\n\nÖNCEKİ DENEMENİN HATASI: ${lastErr}\nŞemaya birebir uy, yalnızca JSON döndür.`;
    try {
      const r = await adapter.annotate({ system: sys, user });
      return { chunk: llmChunkSchema.parse(r.json), usage: r.usage };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(t(lang, 'error.llmOutputInvalid', { error: lastErr }));
}

// Ham metin + tarz + ses modu → LLM → doğrulanmış script (scripts.source='llm').
export async function annotateChapter(
  db: Db, chapterId: string, adapter: LlmAdapter,
  opts?: { instruction?: string; onProgress?: (done: number, total: number) => void; lang?: Lang },
): Promise<AnnotateOutcome> {
  const lang = opts?.lang ?? 'tr';
  const chapter = getChapter(db, chapterId);
  if (!chapter) throw new Error(t(lang, 'error.chapterNotFound'));
  const voiceMode = chapter.voiceMode === 'multi' ? ('multi' as const) : ('narrator' as const);
  const chunks = chunkText(chapter.rawText, undefined, lang);

  // Havuz aktif TTS sağlayıcısından; mock test altyapısıdır, gemini havuzunu kullanır.
  const providerName = activeProvider(db).name;
  const pool = loadPool(db, providerName === 'mock' ? 'gemini' : providerName);
  const narratorVoice = getSetting(db, 'default_voice') ?? pool[0]?.voiceId;
  if (!narratorVoice) throw new Error(t(lang, 'error.voicePoolEmpty'));

  // Yeniden üretimde önceki denemenin kısa özeti prompt'a girer.
  let prevSummary: string | undefined;
  if (opts?.instruction) {
    const prev = latestScript(db, chapterId);
    if (prev) {
      const pj = JSON.parse(prev.json) as { cast?: { character_id: string }[]; segments?: unknown[] };
      prevSummary = `v${prev.version}: ${pj.segments?.length ?? 0} segment, karakterler: ${pj.cast?.map((c) => c.character_id).join(', ') ?? '-'}`;
    }
  }

  const knownCast: LlmCast[] = [];
  const allSegments: LlmChunk['segments'] = [];
  const pron = new Map<string, string>();
  let inputTokens = 0, outputTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const system = buildSystemPrompt({
      voiceMode, maxCharacters: chapter.maxCharacters, narrationStyle: chapter.narrationStyle,
      knownCast: knownCast.length ? knownCast : undefined,
      instruction: opts?.instruction, prevSummary,
    });
    const { chunk, usage } = await annotateChunk(adapter, system, buildUserPrompt(chunks[i], i, chunks.length), lang);
    for (const c of chunk.cast) if (!knownCast.some((k) => k.character_id === c.character_id)) knownCast.push(c); // ilk kazanır
    allSegments.push(...chunk.segments);
    for (const p of chunk.pronunciations) if (!pron.has(p.term)) pron.set(p.term, p.say_as);
    inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
    opts?.onProgress?.(i + 1, chunks.length);
  }

  // Ses ataması: anlatıcı yukarıda hesaplandı; karakterler havuzdan (§2.2).
  const used = new Set<string>([narratorVoice]);
  const cast = [
    { character_id: 'narrator', display_name: t(lang, 'cast.narrator'), voice_id: narratorVoice, base_style: chapter.narrationStyle ?? undefined },
    ...(voiceMode === 'multi'
      ? knownCast.filter((c) => c.character_id !== 'narrator').map((c) => ({
          character_id: c.character_id, display_name: c.display_name,
          voice_id: pickVoice(pool, c.gender, used), base_style: c.persona,
        }))
      : []),
  ];
  const castIds = new Set(cast.map((c) => c.character_id));
  const normalized = allSegments.map((s) => ({
    // narrator modunda veya cast dışı konuşmacıda anlatıcıya düşür (dayanıklılık).
    speaker: voiceMode === 'narrator' || !castIds.has(s.speaker) ? 'narrator' : s.speaker,
    type: s.type, text: s.text, style: s.style, pause_after_ms: s.pause_after_ms,
  }));
  const segs = mergeSegments(normalized).map((s, i) => ({ id: `s${i + 1}`, ...s }));
  const script = {
    schema_version: '1.0', series: chapter.title, season: 1, episode: chapter.position,
    title: chapter.title, language: 'tr-TR', cast, segments: segs,
    ...(pron.size ? { pronunciations: [...pron].map(([term, say_as]) => ({ term, say_as })) } : {}),
  };

  const usage = { inputTokens, outputTokens, chunks: chunks.length };
  const saved = saveScript(db, chapterId, JSON.stringify(script), 'llm', JSON.stringify(usage));
  return { ...saved, castCount: cast.length, usage };
}
