import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = { title: 'webnovel-tts panel' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <header className="topbar"><Link href="/">📚 webnovel-tts</Link></header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
