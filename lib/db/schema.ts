import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  status: text('status').notNull().default('draft'), // draft|scripted|generating|done|error
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
