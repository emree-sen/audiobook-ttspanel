import type { Db } from '../db/client';
import { getSetting } from './settings';
import { getChapter } from './chapters';
import { latestScript, saveScript } from './scripts';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt';
import { llmChunkSchema, type LlmCast, type LlmChunk } from '../llm/schema';
import { GeminiLlmAdapter } from '../llm/gemini';
import { MockLlmAdapter } from '../llm/mock';
import type { LlmAdapter } from '../llm/types';
import { loadPool, pickVoice } from '../voices-pool';
import { geminiApiKey } from './generation';
import { activeProvider } from './quota';

export interface AnnotateOutcome {
  scriptId: string; version: number; segmentCount: number; castCount: number;
  usage: { inputTokens: number; outputTokens: number; chunks: number };
}

const CHUNK_TARGET = 12_000; // karakter; Gemini flash çıktı limitine güvenli mesafe

export function llmAdapterFromSettings(db: Db): LlmAdapter {
  const provider = getSetting(db, 'llm_provider') ?? process.env.LLM_PROVIDER ?? 'gemini';
  if (provider === 'mock') return new MockLlmAdapter();
  const key = geminiApiKey(db);
  if (!key) throw new Error('Gemini API anahtarı yok — Ayarlar’dan girin veya .env GEMINI_API_KEY tanımlayın');
  return new GeminiLlmAdapter(key, getSetting(db, 'llm_model') ?? process.env.LLM_MODEL);
}

// Paragraf sınırından ~target karakterlik parçalar; çoğu bölüm tek parça.
export function chunkText(raw: string, target = CHUNK_TARGET): string[] {
  const text = raw.trim();
  if (!text) throw new Error('Bölüm metni boş — önce ham metni kaydedin');
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

// Tek chunk: LLM çağrısı + zod doğrulama; hatada 1 retry (hata özeti sistem prompt'a eklenir).
async function annotateChunk(adapter: LlmAdapter, system: string, user: string): Promise<{ chunk: LlmChunk; usage: { inputTokens: number; outputTokens: number } }> {
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
  throw new Error(`LLM çıktısı doğrulanamadı: ${lastErr}`);
}

// Ham metin + tarz + ses modu → LLM → doğrulanmış script (scripts.source='llm').
export async function annotateChapter(
  db: Db, chapterId: string, adapter: LlmAdapter,
  opts?: { instruction?: string; onProgress?: (done: number, total: number) => void },
): Promise<AnnotateOutcome> {
  const chapter = getChapter(db, chapterId);
  if (!chapter) throw new Error('Bölüm bulunamadı');
  const voiceMode = chapter.voiceMode === 'multi' ? ('multi' as const) : ('narrator' as const);
  const chunks = chunkText(chapter.rawText);

  // Havuz aktif TTS sağlayıcısından; mock test altyapısıdır, gemini havuzunu kullanır.
  const providerName = activeProvider(db).name;
  const pool = loadPool(db, providerName === 'mock' ? 'gemini' : providerName);
  const narratorVoice = getSetting(db, 'default_voice') ?? pool[0]?.voiceId;
  if (!narratorVoice) throw new Error('Aktif sağlayıcının ses havuzu boş — Ayarlar’dan ses ekleyin');

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
    const { chunk, usage } = await annotateChunk(adapter, system, buildUserPrompt(chunks[i], i, chunks.length));
    for (const c of chunk.cast) if (!knownCast.some((k) => k.character_id === c.character_id)) knownCast.push(c); // ilk kazanır
    allSegments.push(...chunk.segments);
    for (const p of chunk.pronunciations) if (!pron.has(p.term)) pron.set(p.term, p.say_as);
    inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
    opts?.onProgress?.(i + 1, chunks.length);
  }

  // Ses ataması: anlatıcı yukarıda hesaplandı; karakterler havuzdan (§2.2).
  const used = new Set<string>([narratorVoice]);
  const cast = [
    { character_id: 'narrator', display_name: 'Anlatıcı', voice_id: narratorVoice, base_style: chapter.narrationStyle ?? undefined },
    ...(voiceMode === 'multi'
      ? knownCast.filter((c) => c.character_id !== 'narrator').map((c) => ({
          character_id: c.character_id, display_name: c.display_name,
          voice_id: pickVoice(pool, c.gender, used), base_style: c.persona,
        }))
      : []),
  ];
  const castIds = new Set(cast.map((c) => c.character_id));
  const segs = allSegments.map((s, i) => ({
    id: `s${i + 1}`,
    // narrator modunda veya cast dışı konuşmacıda anlatıcıya düşür (dayanıklılık).
    speaker: voiceMode === 'narrator' || !castIds.has(s.speaker) ? 'narrator' : s.speaker,
    type: s.type, text: s.text, style: s.style, pause_after_ms: s.pause_after_ms,
  }));
  const script = {
    schema_version: '1.0', series: chapter.title, season: 1, episode: chapter.position,
    title: chapter.title, language: 'tr-TR', cast, segments: segs,
    ...(pron.size ? { pronunciations: [...pron].map(([term, say_as]) => ({ term, say_as })) } : {}),
  };

  const usage = { inputTokens, outputTokens, chunks: chunks.length };
  const saved = saveScript(db, chapterId, JSON.stringify(script), 'llm', JSON.stringify(usage));
  return { ...saved, castCount: cast.length, usage };
}
