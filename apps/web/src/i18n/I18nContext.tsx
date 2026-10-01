import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import en from './en.json';
import te from './te.json';

export type Language = 'en' | 'te';

type Dict = Record<string, unknown>;

const dictionaries: Record<Language, Dict> = {
  en: en as unknown as Dict,
  te: te as unknown as Dict,
};

const STORAGE_KEY = 'jadal-lang';

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split('.');
  let node: unknown = dict;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

interface I18nValue {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (path: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'te') return saved;
  } catch {
    // storage unavailable; fall through to document language
  }
  return document.documentElement.lang === 'te' ? 'te' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLang);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures (private mode, etc.)
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Language = prev === 'en' ? 'te' : 'en';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (path: string): string => {
      const hit = lookup(dictionaries[lang], path) ?? lookup(dictionaries.en, path);
      return hit ?? path;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
