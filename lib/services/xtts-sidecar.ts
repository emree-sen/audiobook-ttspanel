// lib/services/xtts-sidecar.ts
import { spawn, type ChildProcess } from 'node:child_process';

// Modül-tekil sidecar yöneticisi: panel süreciyle yaşar, detach yok (spec C).
// globalThis çapası: Next dev'de her rota ayrı modül örneği yükleyebilir; modül-global
// tekillik bu yüzden yetmez (KN2, bkz. lib/services/producer.ts ensureWorker) — child/log/
// exitInfo globalThis'e çapalanır, yoksa HMR yeniden-yüklemede canlı child kaybolur
// (öksüz python süreci + çifte spawn).
const LOG_MAX = 50;

interface XttsSidecarState {
  child: ChildProcess | null;
  log: string[];
  exitInfo: string;
  exitHandlersRegistered: boolean;
}

const G = globalThis as unknown as { __xttsSidecar?: XttsSidecarState };
function state(): XttsSidecarState {
  if (!G.__xttsSidecar) G.__xttsSidecar = { child: null, log: [], exitInfo: '', exitHandlersRegistered: false };
  return G.__xttsSidecar;
}

function push(chunk: string) {
  const s = state();
  for (const l of chunk.split('\n')) {
    const t = l.trimEnd();
    if (!t) continue;
    s.log.push(t);
    if (s.log.length > LOG_MAX) s.log.shift();
  }
}

// Panel süreci kapanırken (normal exit / SIGTERM / SIGINT) canlı sidecar'ı da öldür —
// yoksa arka planda öksüz python süreci kalır. Tek seferlik kayıt (start'lar arası
// yinelenmesin diye bayrak globalThis durumunda tutulur).
function ensureExitHandlers() {
  const s = state();
  if (s.exitHandlersRegistered) return;
  s.exitHandlersRegistered = true;
  const killChild = () => { state().child?.kill('SIGTERM'); };
  process.once('exit', killChild);
  process.once('SIGTERM', killChild);
  process.once('SIGINT', killChild);
}

export function xttsStart(dir: string): void {
  const s = state();
  if (s.child) throw new Error('already running');
  s.log = []; s.exitInfo = '';
  s.child = spawn('bash', ['run.sh'], { cwd: dir });
  s.child.stdout?.on('data', (d) => push(String(d)));
  s.child.stderr?.on('data', (d) => push(String(d)));
  s.child.on('exit', (code) => { state().exitInfo = code ? `çıkış kodu ${code}` : ''; state().child = null; });
  s.child.on('error', (e) => { state().exitInfo = e.message; state().child = null; });
  ensureExitHandlers();
}

export function xttsStop(): void { state().child?.kill('SIGTERM'); }
export function xttsStatus(): { alive: boolean; log: string[]; exitInfo: string } {
  const s = state();
  return { alive: s.child !== null, log: [...s.log], exitInfo: s.exitInfo };
}

// Yalnızca testler için: vi.resetModules() modül önbelleğini temizler ama globalThis
// kalıcıdır — bir sonraki testin xttsStart'ı önceki testin (hâlâ "canlı" sahte) child'ını
// görüp yanlışlıkla "already running" fırlatmasın diye durumu sıfırlar (kayıtlı çıkış
// handler bayrağı hariç — o süreç ömrü boyunca tek sefer kalmalı).
export function __xttsResetForTests(): void {
  G.__xttsSidecar = { child: null, log: [], exitInfo: '', exitHandlersRegistered: state().exitHandlersRegistered };
}
