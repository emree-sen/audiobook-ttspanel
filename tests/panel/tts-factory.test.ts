import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { setSetting } from '@/lib/services/settings';
import { createConnection } from '@/lib/services/connections';
import { addPiperModel } from '@/lib/services/voices';
import { activeProvider } from '@/lib/services/quota';
import { adapterFromSettings, geminiApiKey, supportsStyle } from '@/lib/services/generation';
import { MockAdapter } from '@/src/core/tts/mock';
import { GeminiAdapter } from '@/src/core/tts/gemini';
import { OpenAiCompatAdapter } from '@/src/core/tts/openai';
import { PiperAdapter } from '@/src/core/tts/piper';

let db: Db;
const envKey = process.env.GEMINI_API_KEY;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => { if (envKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = envKey; });

describe('supportsStyle', () => {
  test('yalnız gemini ve mock stilli', () => {
    expect(supportsStyle('gemini')).toBe(true);
    expect(supportsStyle('mock')).toBe(true);
    expect(supportsStyle('piper')).toBe(false);
    expect(supportsStyle('alltalk-lokal')).toBe(false);
  });
});

describe('geminiApiKey', () => {
  test('DB önce, env fallback', () => {
    process.env.GEMINI_API_KEY = 'env-anahtar';
    expect(geminiApiKey(db)).toBe('env-anahtar');
    setSetting(db, 'gemini_api_key', 'db-anahtar');
    expect(geminiApiKey(db)).toBe('db-anahtar');
    delete process.env.GEMINI_API_KEY;
    expect(geminiApiKey(db)).toBe('db-anahtar');
  });
});

describe('adapterFromSettings', () => {
  test('mock ve gemini (DB anahtarıyla) kurulur', () => {
    setSetting(db, 'provider', 'mock');
    expect(adapterFromSettings(db)).toBeInstanceOf(MockAdapter);
    delete process.env.GEMINI_API_KEY;
    setSetting(db, 'provider', 'gemini');
    expect(() => adapterFromSettings(db)).toThrow(/anahtar/i);
    setSetting(db, 'gemini_api_key', 'db-anahtar');
    expect(adapterFromSettings(db)).toBeInstanceOf(GeminiAdapter);
  });
  test('bağlantı slug’ı → OpenAiCompatAdapter (id = slug)', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'tts-1' });
    setSetting(db, 'provider', 'sunucum');
    const a = adapterFromSettings(db);
    expect(a).toBeInstanceOf(OpenAiCompatAdapter);
    expect(a.id).toBe('sunucum');
  });
  test('bilinmeyen sağlayıcı → Türkçe hata', () => {
    setSetting(db, 'provider', 'yok-boyle');
    expect(() => adapterFromSettings(db)).toThrow(/Bilinmeyen TTS sağlayıcısı/);
  });
  test('piper: exe ve model şart; tamsa PiperAdapter', () => {
    setSetting(db, 'provider', 'piper');
    expect(() => adapterFromSettings(db)).toThrow(/exe/i);
    setSetting(db, 'piper_exe', 'C:\\piper\\piper.exe');
    expect(() => adapterFromSettings(db)).toThrow(/model/i);
    addPiperModel(db, 'C:\\m\\tr_TR-fahrettin-medium.onnx');
    expect(adapterFromSettings(db)).toBeInstanceOf(PiperAdapter);
  });
});

describe('activeProvider', () => {
  test('bağlantı sağlayıcısında model bağlantıdan gelir; piper modeli boş', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'kokoro' });
    setSetting(db, 'provider', 'sunucum');
    expect(activeProvider(db)).toEqual({ name: 'sunucum', model: 'kokoro@http://x/v1' });
    setSetting(db, 'provider', 'piper');
    expect(activeProvider(db)).toEqual({ name: 'piper', model: '' });
  });
});
