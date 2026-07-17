import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { LogoutButton } from '@/lib/ui/LogoutButton';

const manrope = Manrope({ subsets: ['latin', 'latin-ext'], variable: '--font-manrope' });
const jbmono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-jbmono' });

export const metadata = { title: 'webnovel-tts panel' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${manrope.variable} ${jbmono.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            {/* Dalga-formu marka işareti */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="1" y="6" width="2.5" height="6" rx="1.25" fill="currentColor" />
              <rect x="5" y="3" width="2.5" height="12" rx="1.25" fill="currentColor" />
              <rect x="9" y="1" width="2.5" height="16" rx="1.25" fill="currentColor" opacity="0.85" />
              <rect x="13" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" />
            </svg>
            webnovel-tts
          </Link>
          <span className="spacer" />
          <LogoutButton />
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
