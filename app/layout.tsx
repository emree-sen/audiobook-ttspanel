import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { LANG_COOKIE, resolveLang } from '@/lib/i18n';
import { LanguageProvider } from '@/lib/ui/LanguageProvider';
import { LogoutButton } from '@/lib/ui/LogoutButton';
import { Sidebar } from '@/lib/ui/Sidebar';
import { RegisterSw } from '@/lib/ui/player/RegisterSw';
import { PlayerProvider } from '@/lib/ui/player/PlayerProvider';
import { PlayerBar } from '@/lib/ui/player/PlayerBar';

const manrope = Manrope({ subsets: ['latin', 'latin-ext'], variable: '--font-manrope' });
const jbmono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-jbmono' });

export const metadata = { title: 'audiobook-ttspanel', manifest: '/manifest.webmanifest' };
export const viewport = { themeColor: '#0f1115' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const lang = resolveLang(cookieStore.get(LANG_COOKIE)?.value, headerStore.get('accept-language') ?? undefined);
  return (
    <html lang={lang} className={`${manrope.variable} ${jbmono.variable}`}>
      <body>
        <RegisterSw />
        <LanguageProvider initialLang={lang}>
          <PlayerProvider>
            <header className="topbar">
              <Link href="/" className="brand">
                {/* Dalga-formu marka işareti */}
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <rect x="1" y="6" width="2.5" height="6" rx="1.25" fill="currentColor" />
                  <rect x="5" y="3" width="2.5" height="12" rx="1.25" fill="currentColor" />
                  <rect x="9" y="1" width="2.5" height="16" rx="1.25" fill="currentColor" opacity="0.85" />
                  <rect x="13" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" />
                </svg>
                audiobook-ttspanel
              </Link>
              <span className="spacer" />
              <LogoutButton />
            </header>
            <div className="shell">
              <Sidebar />
              <main className="container">{children}</main>
            </div>
            <PlayerBar />
          </PlayerProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
