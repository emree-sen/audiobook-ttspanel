import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseScript } from '../core/schema.js';
import { generateEpisode } from '../core/orchestrator.js';
import { MockAdapter } from '../core/tts/mock.js';
import { GeminiAdapter } from '../core/tts/gemini.js';
import { formatUsd } from '../core/cost.js';
import type { TtsAdapter } from '../core/types.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath || scriptPath.startsWith('--')) { console.error('Kullanım: generate <script.json> [--out dir] [--provider gemini|mock]'); process.exit(1); }
  const outDir = arg('--out', '.')!;
  const provider = arg('--provider', 'gemini')!;

  const script = parseScript(JSON.parse(await readFile(scriptPath, 'utf8')));
  let adapter: TtsAdapter;
  if (provider === 'mock') adapter = new MockAdapter();
  else {
    const key = process.env.GEMINI_API_KEY;
    if (!key) { console.error('GEMINI_API_KEY tanımlı değil (.env)'); process.exit(1); }
    adapter = new GeminiAdapter(key, arg('--model'));
  }

  console.log(`Üretiliyor: ${script.title} (${script.segments.length} segment) — provider: ${adapter.id}`);
  const r = await generateEpisode(script, adapter, (d, t) => process.stdout.write(`\r  ${d}/${t} segment`));
  process.stdout.write('\n');

  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'episode.mp3');
  await writeFile(outPath, r.mp3);

  for (const s of r.segments) console.log(`  [${s.id}] ${s.speaker.padEnd(10)} ${Math.round(s.durationMs)}ms  ${formatUsd(s.usd)}`);
  console.log(`\n✓ ${outPath}`);
  console.log(`Toplam: ${(r.totalDurationMs / 1000).toFixed(1)}sn ses, maliyet ${formatUsd(r.totalUsd)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
