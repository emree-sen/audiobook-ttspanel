import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Gizli-olmayan varsayılanlar: provider, model, single_voice, default_voice
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  rawText: text('raw_text').notNull().default(''),
  narrationStyle: text('narration_style'),
  voiceMode: text('voice_mode').notNull().default('narrator'), // narrator|multi
  maxCharacters: integer('max_characters').notNull().default(6),
  status: text('status').notNull().default('draft'), // draft|scripted|generating|voiced|done|error
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  source: text('source').notNull(), // manual|llm (Dilim A: manual)
  json: text('json').notNull(),     // doğrulanmış VoiceoverScript JSON metni
  usageJson: text('usage_json'), // LLM üretiminde {"inputTokens":..,"outputTokens":..,"chunks":..}
  createdAt: integer('created_at').notNull(),
});

export const segments = sqliteTable('segments', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  speaker: text('speaker').notNull(),
  style: text('style'),
  text: text('text').notNull(),
  voice: text('voice').notNull(),
  status: text('status').notNull().default('pending'), // pending|done|failed
  audioPath: text('audio_path'), // Dilim A'da NULL; segment-başı dosya Dilim C
  error: text('error'),
  contentHash: text('content_hash'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const renders = sqliteTable('renders', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  path: text('path').notNull(), // audioDir()'e GÖRELİ yol: "<chapterId>/<renderId>.mp3"
  durationSec: real('duration_sec'),
  createdAt: integer('created_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'), // queued|running|done|error|canceled
  limitCalls: integer('limit_calls'),                 // kısmi üretim tavanı (null=sınırsız)
  callsUsed: integer('calls_used').notNull().default(0),
  doneCount: integer('done_count').notNull().default(0),
  totalCount: integer('total_count').notNull(),
  pausedReason: text('paused_reason'),                // quota|limit (status=queued iken duraklama nedeni)
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const ttsCalls = sqliteTable('tts_calls', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull().default(''),
  day: text('day').notNull(), // sağlayıcının sıfırlanma dilimine göre "YYYY-MM-DD"
  segmentId: text('segment_id'),
  ok: integer('ok').notNull().default(1),
  usd: real('usd').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('tts_calls_provider_day').on(t.provider, t.day)]);

export const audioCache = sqliteTable('audio_cache', {
  hash: text('hash').primaryKey(), // sha256: provider|model|voice|style|tags|language|text
  path: text('path').notNull(),    // audioDir'e göreli: "segments/<hash>.wav"
  durationMs: real('duration_ms').notNull().default(0),
  usd: real('usd').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const ttsConnections = sqliteTable('tts_connections', {
  id: text('id').primaryKey(), // kullanıcı slug'ı (^[a-z0-9-]{2,32}$); kota/cache/ses kimliklerinde sağlayıcı adı
  label: text('label').notNull().default(''),
  baseUrl: text('base_url').notNull(), // "/v1" dahil, ör. http://localhost:8000/v1
  apiKey: text('api_key'),             // null = anahtarsız lokal sunucu
  model: text('model').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const voices = sqliteTable('voices', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // gemini | piper | <bağlantı slug'ı>
  voice: text('voice').notNull(),
  gender: text('gender').notNull().default(''), // male|female|'' (bilinmiyor)
  tone: text('tone').notNull().default(''),
  path: text('path'), // yalnız piper: .onnx dosya yolu
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('voices_provider_voice').on(t.provider, t.voice)]);

export const listeningProgress = sqliteTable('listening_progress', {
  chapterId: text('chapter_id').primaryKey().references(() => chapters.id, { onDelete: 'cascade' }),
  positionSec: real('position_sec').notNull().default(0),
  durationSec: real('duration_sec'),
  updatedAt: integer('updated_at').notNull(),
});
