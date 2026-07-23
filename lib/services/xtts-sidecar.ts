// lib/services/xtts-sidecar.ts
import { spawn, type ChildProcess } from 'node:child_process';

// Modül-tekil sidecar yöneticisi: panel süreciyle yaşar, detach yok (spec C).
const LOG_MAX = 50;
let child: ChildProcess | null = null;
let log: string[] = [];
let exitInfo = '';

function push(chunk: string) {
  for (const l of chunk.split('\n')) {
    const s = l.trimEnd();
    if (!s) continue;
    log.push(s);
    if (log.length > LOG_MAX) log.shift();
  }
}

export function xttsStart(dir: string): void {
  if (child) throw new Error('already running');
  log = []; exitInfo = '';
  child = spawn('bash', ['run.sh'], { cwd: dir });
  child.stdout?.on('data', (d) => push(String(d)));
  child.stderr?.on('data', (d) => push(String(d)));
  child.on('exit', (code) => { exitInfo = code ? `çıkış kodu ${code}` : ''; child = null; });
  child.on('error', (e) => { exitInfo = e.message; child = null; });
}

export function xttsStop(): void { child?.kill('SIGTERM'); }
export function xttsStatus(): { alive: boolean; log: string[]; exitInfo: string } {
  return { alive: child !== null, log: [...log], exitInfo };
}
