import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsAdapter, TtsCapabilities, TtsResult, TtsSegmentRequest } from '../types.js';
import { wavDurationMs } from '../audio/wav-info.js';

export type RunProcess = (exe: string, args: string[], stdinText: string) => Promise<void>;

const defaultRun: RunProcess = (exe, args, stdinText) =>
  new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper çıkış kodu ${code}: ${err.slice(-200)}`))));
    p.stdin.end(stdinText, 'utf8');
  });

export interface PiperConfig { exePath: string; models: Record<string, string>; runProcess?: RunProcess }

// Piper lokal TTS: segment başına bir süreç; metin stdin'den, wav geçici dosyadan.
// runProcess enjekte edilebilir — testler gerçek exe olmadan stub'lar.
export class PiperAdapter implements TtsAdapter {
  readonly id = 'piper';
  readonly capabilities: TtsCapabilities = { style: false };
  constructor(private readonly cfg: PiperConfig) {}

  async synthesize(req: TtsSegmentRequest): Promise<TtsResult> {
    const modelPath = this.cfg.models[req.voice.providerVoice];
    if (!modelPath) throw new Error(`Piper ses modeli tanımsız: "${req.voice.providerVoice}" — Ayarlar'dan ekleyin`);
    const tmp = join(tmpdir(), `piper-${randomUUID()}.wav`);
    try {
      await (this.cfg.runProcess ?? defaultRun)(this.cfg.exePath, ['--model', modelPath, '--output_file', tmp], req.text);
      const audio = await readFile(tmp);
      return { audio, format: 'wav', durationMs: wavDurationMs(audio), cost: { unit: 'chars', amount: req.text.length, usd: 0 } };
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }
}
