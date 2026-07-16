import { resolve, sep } from 'node:path';
import { audioDir } from './config';

// URL'den gelen parçaları audioDir altına çözer; dışarı kaçış girişiminde null.
export function safeAudioPath(parts: string[]): string | null {
  const base = resolve(audioDir());
  const full = resolve(base, ...parts);
  return full.startsWith(base + sep) ? full : null;
}
