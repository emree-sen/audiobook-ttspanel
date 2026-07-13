import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { makeSilencePcm, pcmToWav, wavToPcm } from './wav.js';

const execFileAsync = promisify(execFile);

export function concatSegmentsToWav(parts: { wav: Buffer; pauseAfterMs?: number }[]): Buffer {
  const pcms: Buffer[] = [];
  for (const p of parts) {
    pcms.push(wavToPcm(p.wav));
    if (p.pauseAfterMs && p.pauseAfterMs > 0) pcms.push(makeSilencePcm(p.pauseAfterMs));
  }
  return pcmToWav(Buffer.concat(pcms));
}

export async function wavToMp3(wav: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static bulunamadı');
  const dir = await mkdtemp(join(tmpdir(), 'wntts-'));
  const inPath = join(dir, 'in.wav');
  const outPath = join(dir, 'out.mp3');
  try {
    await writeFile(inPath, wav);
    await execFileAsync(ffmpegPath, ['-y', '-i', inPath, '-c:a', 'libmp3lame', '-b:a', '128k', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
