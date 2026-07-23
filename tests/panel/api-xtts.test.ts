// tests/panel/api-xtts.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const xttsStartMock = vi.fn();
const xttsStopMock = vi.fn();
const xttsStatusMock = vi.fn();
vi.mock('@/lib/services/xtts-sidecar', () => ({
  xttsStart: (...a: unknown[]) => xttsStartMock(...a),
  xttsStop: (...a: unknown[]) => xttsStopMock(...a),
  xttsStatus: (...a: unknown[]) => xttsStatusMock(...a),
}));

import * as xttsRoute from '@/app/api/xtts/route';

const req = (method: string) => new NextRequest('http://p', { method });

describe('GET/POST/DELETE /api/xtts', () => {
  beforeEach(() => {
    xttsStartMock.mockReset();
    xttsStopMock.mockReset();
    xttsStatusMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  test('GET: canlı değil + exitInfo yok → stopped', async () => {
    xttsStatusMock.mockReturnValue({ alive: false, log: [], exitInfo: '' });
    const d = await (await xttsRoute.GET()).json();
    expect(d.state).toBe('stopped');
    expect(d.voices).toEqual([]);
  });

  test('GET: canlı + /health ulaşılamıyor → starting', async () => {
    xttsStatusMock.mockReturnValue({ alive: true, log: ['x'], exitInfo: '' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const d = await (await xttsRoute.GET()).json();
    expect(d.state).toBe('starting');
  });

  test('GET: canlı + /health ok → running + sesler', async () => {
    xttsStatusMock.mockReturnValue({ alive: true, log: [], exitInfo: '' });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ voices: ['a', 'b'] }) }));
    const d = await (await xttsRoute.GET()).json();
    expect(d.state).toBe('running');
    expect(d.voices).toEqual(['a', 'b']);
  });

  test('POST: zaten canlıyken 409', async () => {
    xttsStatusMock.mockReturnValue({ alive: true, log: [], exitInfo: '' });
    const res = await xttsRoute.POST(req('POST'));
    expect(res.status).toBe(409);
    expect(xttsStartMock).not.toHaveBeenCalled();
  });

  test('POST: kapalıyken 202 + xttsStart tools/xtts-server yoluyla çağrılır', async () => {
    xttsStatusMock.mockReturnValue({ alive: false, log: [], exitInfo: '' });
    const res = await xttsRoute.POST(req('POST'));
    expect(res.status).toBe(202);
    expect(xttsStartMock).toHaveBeenCalledTimes(1);
    expect(String(xttsStartMock.mock.calls[0][0])).toMatch(/tools[\\/]xtts-server$/);
  });

  test('DELETE: çalışmıyorken 409', async () => {
    xttsStatusMock.mockReturnValue({ alive: false, log: [], exitInfo: '' });
    const res = await xttsRoute.DELETE(req('DELETE'));
    expect(res.status).toBe(409);
    expect(xttsStopMock).not.toHaveBeenCalled();
  });
});
