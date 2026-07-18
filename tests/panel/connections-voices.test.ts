import { beforeEach, describe, expect, test } from 'vitest';
import { createDb, type Db } from '@/lib/db/client';
import { getSetting, setSetting, deleteSetting } from '@/lib/services/settings';
import { createConnection, deleteConnection, getConnection, listConnections } from '@/lib/services/connections';
import { OPENAI_DEFAULT_VOICES, addOpenAiDefaults, addPiperModel, addVoice, deleteVoice, listVoices, updateVoice } from '@/lib/services/voices';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

describe('migration tohumu', () => {
  test('gemini havuzu 8 sesle tohumlanır, ilk ses Charon', () => {
    const pool = listVoices(db, 'gemini');
    expect(pool).toHaveLength(8);
    expect(pool[0].voice).toBe('Charon');
    expect(pool[0].gender).toBe('male');
    expect(pool.filter((v) => v.gender === 'female')).toHaveLength(2);
  });
});

describe('connections', () => {
  test('oluştur/listele/sil; slug ve URL doğrulanır', () => {
    const c = createConnection(db, { id: 'alltalk-lokal', label: 'AllTalk', baseUrl: 'http://localhost:8000/v1', model: 'tts-1' });
    expect(c.id).toBe('alltalk-lokal');
    expect(listConnections(db)).toHaveLength(1);
    expect(getConnection(db, 'alltalk-lokal')?.model).toBe('tts-1');
    deleteConnection(db, 'alltalk-lokal');
    expect(listConnections(db)).toHaveLength(0);
  });
  test('geçersiz slug, rezerve ad, mükerrer ad, bozuk URL, boş model → Türkçe hata', () => {
    expect(() => createConnection(db, { id: 'Büyük Harf', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/küçük harf/);
    expect(() => createConnection(db, { id: 'openai', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/rezerve/);
    createConnection(db, { id: 'ayni', baseUrl: 'http://x/v1', model: 'm' });
    expect(() => createConnection(db, { id: 'ayni', baseUrl: 'http://x/v1', model: 'm' })).toThrow(/zaten var/);
    expect(() => createConnection(db, { id: 'bozuk-url', baseUrl: 'localhost', model: 'm' })).toThrow(/URL/);
    expect(() => createConnection(db, { id: 'bos-model', baseUrl: 'http://x/v1', model: ' ' })).toThrow(/model/);
  });
  test('silince ses havuzu temizlenir; aktif sağlayıcı buysa provider ayarı sıfırlanır', () => {
    createConnection(db, { id: 'sunucum', baseUrl: 'http://x/v1', model: 'm' });
    addVoice(db, { provider: 'sunucum', voice: 'alloy' });
    setSetting(db, 'provider', 'sunucum');
    deleteConnection(db, 'sunucum');
    expect(listVoices(db, 'sunucum')).toHaveLength(0);
    expect(getSetting(db, 'provider')).toBeUndefined();
  });
});

describe('voices', () => {
  test('ekle/güncelle/sil; aynı sağlayıcıda mükerrer ses reddedilir', () => {
    const v = addVoice(db, { provider: 'gemini', voice: 'Zephyr', gender: 'female', tone: 'nazik' });
    expect(listVoices(db, 'gemini')).toHaveLength(9);
    expect(() => addVoice(db, { provider: 'gemini', voice: 'Zephyr' })).toThrow(/zaten/);
    const u = updateVoice(db, v.id, { tone: 'sert' });
    expect(u.tone).toBe('sert');
    deleteVoice(db, v.id);
    expect(listVoices(db, 'gemini')).toHaveLength(8);
    expect(() => updateVoice(db, 'voc_yok', { tone: 'x' })).toThrow(/bulunamadı/);
  });
  test('geçersiz gender ve boş voice reddedilir', () => {
    expect(() => addVoice(db, { provider: 'gemini', voice: 'X', gender: 'robot' })).toThrow(/cinsiyet/i);
    expect(() => addVoice(db, { provider: 'gemini', voice: '  ' })).toThrow(/ses adı/i);
  });
  test('addPiperModel: ad .onnx dosya adından türer; .onnx dışı reddedilir', () => {
    const v = addPiperModel(db, 'C:\\modeller\\tr_TR-fahrettin-medium.onnx');
    expect(v.provider).toBe('piper');
    expect(v.voice).toBe('tr_TR-fahrettin-medium');
    expect(v.path).toBe('C:\\modeller\\tr_TR-fahrettin-medium.onnx');
    expect(() => addPiperModel(db, 'C:\\x\\ses.bin')).toThrow(/onnx/i);
  });
  test('addOpenAiDefaults: resmî sesler eklenir, mevcutlar atlanır', () => {
    createConnection(db, { id: 'bulut', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' });
    addVoice(db, { provider: 'bulut', voice: 'alloy' });
    const n = addOpenAiDefaults(db, 'bulut');
    expect(n).toBe(OPENAI_DEFAULT_VOICES.length - 1);
    expect(listVoices(db, 'bulut')).toHaveLength(OPENAI_DEFAULT_VOICES.length);
  });
});

describe('deleteSetting', () => {
  test('ayarı siler; olmayan anahtar sorun değil', () => {
    setSetting(db, 'k', 'v');
    deleteSetting(db, 'k');
    expect(getSetting(db, 'k')).toBeUndefined();
    deleteSetting(db, 'k');
  });
});
