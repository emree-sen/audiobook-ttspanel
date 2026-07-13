import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execFileAsync = promisify(execFile);

test('CLI mock provider ile episode.mp3 üretir', async () => {
  const out = await mkdtemp(join(tmpdir(), 'cli-'));
  try {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli/generate.ts', 'fixtures/sample-tr.json', '--out', out, '--provider', 'mock'], { shell: true });
    expect(stdout).toContain('Toplam');
    const mp3 = await readFile(join(out, 'episode.mp3'));
    expect(mp3.length).toBeGreaterThan(0);
  } finally { await rm(out, { recursive: true, force: true }); }
}, 30000);
