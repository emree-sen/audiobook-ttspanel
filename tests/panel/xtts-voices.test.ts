import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteVoiceFile, listVoiceFiles, sanitizeVoiceName, saveVoiceFile } from '@/lib/services/xtts-voices';

const RIFF = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]);
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtts-voices-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('sanitizeVoiceName', () => {
  test('türkçe/boşluk/uzantı temizlenir', () => {
    expect(sanitizeVoiceName('Kaan Ağabey.WAV')).toBe('kaan-a-abey');
  });
  test('path traversal etkisiz', () => {
    expect(sanitizeVoiceName('../../etc/passwd')).toBe('etc-passwd');
  });
  test('tümü geçersizse hata', () => {
    expect(() => sanitizeVoiceName('....')).toThrow();
  });
});

describe('save/list/delete', () => {
  test('kaydet → listede; sil → listeden düşer', () => {
    const name = saveVoiceFile('Deneme Sesi.wav', RIFF, dir);
    expect(name).toBe('deneme-sesi');
    expect(listVoiceFiles(dir)).toEqual(['deneme-sesi']);
    deleteVoiceFile('deneme-sesi', dir);
    expect(listVoiceFiles(dir)).toEqual([]);
  });
  test('RIFF başlığı yoksa red', () => {
    expect(() => saveVoiceFile('a.wav', Buffer.from('not a wav'), dir)).toThrow(/WAV/);
  });
  test('20MB üstü red', () => {
    const big = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(21 * 1024 * 1024)]);
    expect(() => saveVoiceFile('a.wav', big, dir)).toThrow(/büyük/);
  });
  test('olmayan dosya silinince hata; dizin dışına çıkamaz', () => {
    expect(() => deleteVoiceFile('yok', dir)).toThrow();
    expect(() => deleteVoiceFile('../server', dir)).toThrow();
  });
  test('liste: yalnız .wav, uzantısız adlar, sıralı; olmayan dizin boş liste', () => {
    saveVoiceFile('b.wav', RIFF, dir); saveVoiceFile('a.wav', RIFF, dir);
    fs.writeFileSync(path.join(dir, 'not-voice.txt'), 'x');
    expect(listVoiceFiles(dir)).toEqual(['a', 'b']);
    expect(listVoiceFiles(path.join(dir, 'yok'))).toEqual([]);
  });
});
