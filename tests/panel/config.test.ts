import { afterEach, describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { audioDir, dataDir, dbPath } from '@/lib/config';
import { newId } from '@/lib/id';

describe('config', () => {
  afterEach(() => { delete process.env.DATA_DIR; delete process.env.DB_PATH; });

  test('varsayılan: ./data altı', () => {
    expect(dataDir()).toBe(join(process.cwd(), 'data'));
    expect(dbPath()).toBe(join(dataDir(), 'app.db'));
    expect(audioDir()).toBe(join(dataDir(), 'audio'));
  });

  test('DATA_DIR env ile değişir (lazy)', () => {
    process.env.DATA_DIR = join('C:', 'tmp', 'wnt');
    expect(dataDir()).toBe(join('C:', 'tmp', 'wnt'));
    expect(audioDir()).toBe(join('C:', 'tmp', 'wnt', 'audio'));
  });
});

describe('newId', () => {
  test('önek + 12 hex, benzersiz', () => {
    const a = newId('prj'), b = newId('prj');
    expect(a).toMatch(/^prj_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
