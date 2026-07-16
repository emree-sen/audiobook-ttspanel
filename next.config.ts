import type { NextConfig } from 'next';

// Native/binary paketler bundle edilmesin (better-sqlite3 .node dosyası, ffmpeg-static binary yolu)
const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'ffmpeg-static'],
};
export default nextConfig;
