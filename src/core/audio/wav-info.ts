// RIFF/WAVE başlığından süre: fmt chunk'ındaki byteRate + data chunk boyutu.
// Tanınmayan/bozuk girdi için 0 döner (fırlatmaz) — süre bilgisi kritik değil.
export function wavDurationMs(wav: Buffer): number {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let off = 12, byteRate = 0, dataSize = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 20 <= wav.length) byteRate = wav.readUInt32LE(off + 16);
    if (id === 'data') { dataSize = Math.min(size, wav.length - off - 8); break; }
    off += 8 + size + (size % 2); // chunk'lar 2 bayta hizalanır
  }
  return byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 0;
}
