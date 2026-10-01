import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import en from "./en.json";
import te from "./te.json";

export type Lang = "te" | "en";

const dicts: Record<Lang, Record<string, string>> = {
  en: en as Record<string, string>,
  te: te as Record<string, string>,
};

export type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children, initial = "te" }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(initial);
  const t = useCallback(
    (key: string): string => {
      const d = dicts[lang];
      const v = d[key];
      if (v !== undefined) return v;
      const fallback = dicts.en[key];
      return fallback ?? key;
    },
    [lang],
  );
  const value = useMemo<I18n>(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <LanguageProvider>");
  return ctx;
}
