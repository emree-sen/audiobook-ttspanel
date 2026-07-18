import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { makeSilencePcm, pcmToWav } from '@/src/core/audio/wav';
import { PiperAdapter, type RunProcess } from '@/src/core/tts/piper';

const REQ = { text: 'İyi akşamlar', voice: { provider: 'piper', providerVoice: 'tr_TR-fahrettin-medium' }, language: 'tr-TR' };

describe('PiperAdapter', () => {
  test('doğru argümanlarla süreci çağırır; stdin metni; wav geçici dosyadan okunur ve silinir', async () => {
    let captured: { exe: string; args: string[]; stdin: string } | null = null;
    const run: RunProcess = async (exe, args, stdin) => {
      captured = { exe, args, stdin };
      await writeFile(args[args.indexOf('--output_file') + 1], pcmToWav(makeSilencePcm(300)));
    };
    const a = new PiperAdapter({ exePath: 'C:\\piper\\piper.exe', models: { 'tr_TR-fahrettin-medium': 'C:\\m\\tr.onnx' }, runProcess: run });
    expect(a.capabilities).toEqual({ style: false });
    const res = await a.synthesize(REQ);
    expect(captured!.exe).toBe('C:\\piper\\piper.exe');
    expect(captured!.args.slice(0, 2)).toEqual(['--model', 'C:\\m\\tr.onnx']);
    expect(captured!.stdin).toBe('İyi akşamlar');
    expect(res.durationMs).toBe(300);
    expect(res.cost).toEqual({ unit: 'chars', amount: 'İyi akşamlar'.length, usd: 0 });
  });
  test('tanımsız ses adı → Türkçe hata, süreç çağrılmaz', async () => {
    const a = new PiperAdapter({ exePath: 'p', models: {}, runProcess: async () => { throw new Error('çağrılmamalı'); } });
    await expect(a.synthesize(REQ)).rejects.toThrow(/tanımsız/);
  });
  test('süreç hatası yayılır', async () => {
    const a = new PiperAdapter({ exePath: 'p', models: { 'tr_TR-fahrettin-medium': 'x.onnx' }, runProcess: async () => { throw new Error('piper çıkış kodu 1'); } });
    await expect(a.synthesize(REQ)).rejects.toThrow(/çıkış kodu 1/);
  });
});
