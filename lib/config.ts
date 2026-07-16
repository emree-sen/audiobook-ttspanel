import { join } from 'node:path';

// Lazy fonksiyonlar: testler process.env'i çalışma anında değiştirebilsin.
export function dataDir(): string { return process.env.DATA_DIR ?? join(process.cwd(), 'data'); }
export function dbPath(): string { return process.env.DB_PATH ?? join(dataDir(), 'app.db'); }
export function audioDir(): string { return join(dataDir(), 'audio'); }
