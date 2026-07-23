import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { deleteSetting, getSetting, setSetting } from '@/lib/services/settings';
import { getConnection, listConnections } from '@/lib/services/connections';
import { listVoices } from '@/lib/services/voices';
import { quotaLimit } from '@/lib/services/quota';
import { tServer } from '@/lib/i18n/server';

function maskKey(v: string): string { return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`; }

export async function GET() {
  const db = getDb();
  const connections = listConnections(db).map((c) => ({ id: c.id, label: c.label, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey }));
  const providers = ['gemini', 'piper', ...connections.map((c) => c.id)];
  const dbKey = getSetting(db, 'gemini_api_key');
  return NextResponse.json({
    provider: getSetting(db, 'provider') ?? process.env.TTS_PROVIDER ?? 'gemini',
    model: getSetting(db, 'model') ?? '',
    llmProvider: getSetting(db, 'llm_provider') ?? 'gemini',
    llmModel: getSetting(db, 'llm_model') ?? '',
    llmBaseUrl: getSetting(db, 'llm_base_url') ?? '',
    llmApiKey: (() => { const k = getSetting(db, 'llm_api_key'); return k ? maskKey(k) : null; })(),
    piperExe: getSetting(db, 'piper_exe') ?? '',
    geminiKey: dbKey ? maskKey(dbKey) : null,
    geminiKeySource: dbKey ? 'db' : process.env.GEMINI_API_KEY ? 'env' : null,
    quotaLimits: Object.fromEntries(providers.map((p) => [p, quotaLimit(db, p)])),
    connections,
    voices: Object.fromEntries(['gemini', 'piper', ...connections.map((c) => c.id)].map((p) => [p, listVoices(db, p)])),
  });
}

const putSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().optional(),
  llmProvider: z.enum(['gemini', 'mock', 'openai-compat']).optional(),
  llmModel: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().min(1).refine((v) => !v.includes('•'), 'maskeli değer kaydedilemez').nullable().optional(),
  piperExe: z.string().optional(),
  // Maskeli değerin geri yazılmasına karşı koruma: • içeren anahtar reddedilir.
  geminiKey: z.string().min(8).refine((v) => !v.includes('•'), 'maskeli değer kaydedilemez').nullable().optional(),
  quotaLimits: z.record(z.number().int().positive().nullable()).optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const db = getDb();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: tServer(req, 'error.invalidBody') }, { status: 400 });
  const b = parsed.data;
  if (b.provider && !['gemini', 'piper', 'mock'].includes(b.provider) && !getConnection(db, b.provider))
    return NextResponse.json({ error: tServer(req, 'error.unknownProvider', { provider: b.provider }) }, { status: 400 });
  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    if (value) setSetting(db, key, value); else deleteSetting(db, key);
  };
  if (b.provider !== undefined) setSetting(db, 'provider', b.provider);
  setOrDelete('model', b.model);
  if (b.llmProvider !== undefined) setSetting(db, 'llm_provider', b.llmProvider);
  setOrDelete('llm_model', b.llmModel);
  setOrDelete('llm_base_url', b.llmBaseUrl);
  if (b.llmApiKey === null) deleteSetting(db, 'llm_api_key');
  else if (typeof b.llmApiKey === 'string') setSetting(db, 'llm_api_key', b.llmApiKey);
  setOrDelete('piper_exe', b.piperExe);
  if (b.geminiKey === null) deleteSetting(db, 'gemini_api_key');
  else if (typeof b.geminiKey === 'string') setSetting(db, 'gemini_api_key', b.geminiKey);
  for (const [p, lim] of Object.entries(b.quotaLimits ?? {})) {
    if (lim == null) deleteSetting(db, `quota_limit_${p}`);
    else setSetting(db, `quota_limit_${p}`, String(lim));
  }
  return NextResponse.json({ ok: true });
}
