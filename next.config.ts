import type { NextConfig } from 'next';

// Native/binary paketler bundle edilmesin (better-sqlite3 .node dosyası, ffmpeg-static binary yolu)
const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'ffmpeg-static'],
  // src/core ESM-stili ".js" uzantılı importları (ör. './voices.js' -> voices.ts) webpack'te çözülsün
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.js'] };
    return config;
  },
};
export default nextConfig;
