'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { format, getDict, LANG_COOKIE, type Lang, type MessageKey } from '@/lib/i18n';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void } | null>(null);

export function LanguageProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    setLangState(l);
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLang: LanguageProvider yok');
  return v;
}

export function useT() {
  const { lang } = useLang();
  const dict = getDict(lang);
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) =>
      params ? format(dict[key], params) : dict[key],
    [dict],
  );
}
