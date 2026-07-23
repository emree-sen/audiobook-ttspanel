// tests/panel/xtts-sidecar.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

function fakeChild() {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => void; killed: boolean };
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.killed = false; c.kill = vi.fn(() => { c.killed = true; });
  return c;
}

describe('xtts-sidecar', () => {
  beforeEach(() => { vi.resetModules(); spawnMock.mockReset(); });

  test('start: run.sh spawn edilir, loglar halka tamponda birikir', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/repo/tools/xtts-server');
    expect(spawnMock).toHaveBeenCalledWith('bash', ['run.sh'], { cwd: '/repo/tools/xtts-server' });
    c.stdout.emit('data', Buffer.from('satır 1\nsatır 2\n'));
    c.stderr.emit('data', Buffer.from('uyarı\n'));
    const s = mod.xttsStatus();
    expect(s.alive).toBe(true);
    expect(s.log).toEqual(['satır 1', 'satır 2', 'uyarı']);
  });

  test('çifte start reddedilir; exit sonrası tekrar start olur', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    expect(() => mod.xttsStart('/d')).toThrow();
    c.emit('exit', 0);
    expect(mod.xttsStatus().alive).toBe(false);
    spawnMock.mockReturnValue(fakeChild());
    expect(() => mod.xttsStart('/d')).not.toThrow();
  });

  test('sıfır-dışı çıkış kodu error detayına yazılır', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    c.emit('exit', 1);
    const s = mod.xttsStatus();
    expect(s.alive).toBe(false);
    expect(s.exitInfo).toContain('1');
  });

  test('stop: kill çağrılır', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    mod.xttsStop();
    expect(c.kill).toHaveBeenCalled();
  });

  test('log tamponu 50 satırla sınırlı', async () => {
    const mod = await import('@/lib/services/xtts-sidecar');
    const c = fakeChild(); spawnMock.mockReturnValue(c);
    mod.xttsStart('/d');
    for (let i = 0; i < 60; i++) c.stdout.emit('data', Buffer.from(`satır ${i}\n`));
    const s = mod.xttsStatus();
    expect(s.log).toHaveLength(50);
    expect(s.log[0]).toBe('satır 10');
  });
});
