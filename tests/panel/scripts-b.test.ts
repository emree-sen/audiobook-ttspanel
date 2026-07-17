import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createProject } from '@/lib/services/projects';
import { createChapter, getChapter } from '@/lib/services/chapters';
import { changeCastVoice, importScript, latestScript, saveScript } from '@/lib/services/scripts';

const FIXTURE = readFileSync('fixtures/sample-tr.json', 'utf8');

function setup() {
  const db = createDb(':memory:');
  const p = createProject(db, { title: 'R' });
  const c = createChapter(db, p.id, { title: 'B1' });
  return { db, chapterId: c.id };
}

describe('şema genişletmesi', () => {
  test('yeni bölüm varsayılanları: voiceMode narrator, maxCharacters 6', () => {
    const { db, chapterId } = setup();
    const c = getChapter(db, chapterId)!;
    expect(c.voiceMode).toBe('narrator');
    expect(c.maxCharacters).toBe(6);
  });
});

describe('saveScript', () => {
  test('source=llm + usageJson kaydedilir; importScript manual kalır', () => {
    const { db, chapterId } = setup();
    const usage = JSON.stringify({ inputTokens: 10, outputTokens: 20, chunks: 1 });
    const r = saveScript(db, chapterId, FIXTURE, 'llm', usage);
    expect(r.version).toBe(1);
    expect(latestScript(db, chapterId)).toMatchObject({ source: 'llm', usageJson: usage });

    const r2 = importScript(db, chapterId, FIXTURE);
    expect(r2.version).toBe(2);
    expect(latestScript(db, chapterId)).toMatchObject({ source: 'manual', usageJson: null });
  });
});

describe('changeCastVoice', () => {
  test('sesi değiştirir, yeni versiyon yazar, source/usage korunur', () => {
    const { db, chapterId } = setup();
    saveScript(db, chapterId, FIXTURE, 'llm', '{"inputTokens":1,"outputTokens":2,"chunks":1}');
    const r = changeCastVoice(db, chapterId, 'kaan', 'gemini:Iapetus');
    expect(r.version).toBe(2);
    const scr = latestScript(db, chapterId)!;
    expect(scr.source).toBe('llm');
    expect(scr.usageJson).toContain('inputTokens');
    const cast = JSON.parse(scr.json).cast as { character_id: string; voice_id: string }[];
    expect(cast.find((c) => c.character_id === 'kaan')?.voice_id).toBe('gemini:Iapetus');
    expect(cast.find((c) => c.character_id === 'narrator')?.voice_id).toBe('gemini:Charon'); // dokunulmadı
  });

  test('bilinmeyen karakter / bozuk voiceId / script yok → Türkçe hata', () => {
    const { db, chapterId } = setup();
    expect(() => changeCastVoice(db, chapterId, 'kaan', 'gemini:X')).toThrow(/script/i);
    importScript(db, chapterId, FIXTURE);
    expect(() => changeCastVoice(db, chapterId, 'hayalet', 'gemini:Puck')).toThrow(/Karakter bulunamadı/);
    expect(() => changeCastVoice(db, chapterId, 'kaan', 'bozukses')).toThrow(/voice_id/);
  });
});
