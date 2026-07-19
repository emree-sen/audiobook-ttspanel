// İndirme yönetimi: Cache Storage (sw.js bu cache'ten cache-first servis eder).
// AUDIO_CACHE, public/sw.js VERSION'ı ile eşleşmeli (wnt-v1).
const AUDIO_CACHE = 'wnt-v1-audio';

export function audioUrl(renderPath: string): string { return `/api/audio/${renderPath}`; }

export async function downloadChapter(renderPath: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const res = await fetch(audioUrl(renderPath));
  if (!res.ok) return false;
  await (await caches.open(AUDIO_CACHE)).put(audioUrl(renderPath), res);
  return true;
}

export async function removeDownload(renderPath: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  await (await caches.open(AUDIO_CACHE)).delete(audioUrl(renderPath), { ignoreSearch: true });
}

export async function downloadedSet(): Promise<Set<string>> {
  if (typeof caches === 'undefined') return new Set();
  const keys = await (await caches.open(AUDIO_CACHE)).keys();
  return new Set(keys.map((r) => new URL(r.url).pathname.replace(/^\/api\/audio\//, '')));
}

export async function storageEstimateText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage } = await navigator.storage.estimate();
  return usage != null ? `${(usage / 1024 / 1024).toFixed(1)} MB` : null;
}
