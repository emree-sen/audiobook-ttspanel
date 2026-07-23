import fs from 'node:fs';
import path from 'node:path';
import { t, type Lang } from '../i18n';

// XTTS referans sesleri: dosya adı = ses adı sözleşmesi (tools/xtts-server/README).
export const XTTS_VOICES_DIR = path.join(process.cwd(), 'tools', 'xtts-server', 'voices');
const MAX_BYTES = 20 * 1024 * 1024;

export function sanitizeVoiceName(raw: string, lang: Lang = 'tr'): string {
  const base = raw.toLowerCase().replace(/\.wav$/i, '')
    .replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) throw new Error(t(lang, 'xttsVoices.invalidName'));
  return base;
}

export function listVoiceFiles(dir = XTTS_VOICES_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort();
}

export function saveVoiceFile(name: string, data: Buffer, dir = XTTS_VOICES_DIR, lang: Lang = 'tr'): string {
  if (data.length > MAX_BYTES) throw new Error(t(lang, 'xttsVoices.tooBig'));
  if (data.length < 44 || data.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error(t(lang, 'xttsVoices.notWav'));
  const safe = sanitizeVoiceName(name, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${safe}.wav`), data);
  return safe;
}

export function deleteVoiceFile(name: string, dir = XTTS_VOICES_DIR, lang: Lang = 'tr'): void {
  const p = path.join(dir, `${sanitizeVoiceName(name, lang)}.wav`);
  if (!fs.existsSync(p)) throw new Error(t(lang, 'xttsVoices.notFound'));
  fs.unlinkSync(p);
}
