import { useEffect, useMemo, useState } from "react";
import { LanguageProvider, useI18n } from "../i18n/I18nContext";
import type { Lang } from "../i18n/I18nContext";
import type { FarmerApi, FarmerDirectoryEntry } from "../api/client";
import { createFarmerApi, scenario } from "../api/client";
import RegistrationForm from "./RegistrationForm";
import MyWater from "./MyWater";
import UrgentRequestForm from "./UrgentRequestForm";
import BufferBoard from "./BufferBoard";
import "./farmer.css";

type Tab = "register" | "mywater" | "urgent" | "buffer";
const TABS: Tab[] = ["register", "mywater", "urgent", "buffer"];

function Portal() {
  const { t, lang, setLang } = useI18n();
  const api: FarmerApi = useMemo(() => createFarmerApi(), []);
  const [directory, setDirectory] = useState<FarmerDirectoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [farmerId, setFarmerId] = useState<string>("f1");
  const [tab, setTab] = useState<Tab>("mywater");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listFarmers()
      .then((d) => {
        if (cancelled) return;
        setDirectory(d);
        const first = d[0];
        if (first && !d.some((e) => e.farmer.id === farmerId)) setFarmerId(first.farmer.id);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const entry = directory?.find((e) => e.farmer.id === farmerId) ?? null;
  const farmerName = (id: string) => directory?.find((e) => e.farmer.id === id)?.farmer.name ?? id;

  return (
    <div className="farmer-portal" data-theme={theme}>
      <div className="fp-container">
        <header className="fp-header">
          <h1>{t("app.title")}</h1>
          <div className="fp-controls">
            <label htmlFor="fp-lang">{t("app.language")}</label>
            <select id="fp-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ minHeight: "3rem", fontSize: "1rem" }}>
              <option value="te">తెలుగు</option>
              <option value="en">English</option>
            </select>
            <button
              type="button"
              className="fp-btn fp-btn-secondary"
              onClick={() => setTheme((p) => (p === "light" ? "dark" : "light"))}
              aria-pressed={theme === "dark"}
            >
              {theme === "light" ? t("app.themeDark") : t("app.themeLight")}
            </button>
          </div>
          <p>{t("app.subtitle")}</p>
          <p className="fp-source" aria-live="polite">
            {api.source === "mock" ? t("app.offlineNote") : t("app.liveNote")}
          </p>
        </header>

        {failed && (
          <div className="fp-errors" role="alert">
            {t("app.error")}{" "}
            <button type="button" className="fp-btn fp-btn-secondary" onClick={() => window.location.reload()}>
              {t("app.retry")}
            </button>
          </div>
        )}

        <div className="fp-field">
          <label htmlFor="fp-farmer">{t("app.selectFarmer")}</label>
          <select id="fp-farmer" value={farmerId} onChange={(e) => setFarmerId(e.target.value)}>
            {(directory ?? []).map((e) => (
              <option key={e.farmer.id} value={e.farmer.id}>
                {e.farmer.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="fp-tabs" aria-label={t("app.title")}>
          {TABS.map((tb) => (
            <button key={tb} type="button" className="fp-tab" aria-selected={tab === tb} onClick={() => setTab(tb)}>
              {t(`tab.${tb}`)}
            </button>
          ))}
        </nav>

        <main>
          {tab === "register" && <RegistrationForm api={api} outlets={scenario.outlets} />}
          {tab === "mywater" && <MyWater api={api} farmerId={farmerId} />}
          {tab === "urgent" && (
            <UrgentRequestForm api={api} farmerId={farmerId} cropPlans={entry?.cropPlans ?? []} onRaised={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === "buffer" && <BufferBoard api={api} farmerName={farmerName} refreshKey={refreshKey} />}
        </main>
      </div>
    </div>
  );
}

export default function FarmerPortal() {
  return (
    <LanguageProvider initial="te">
      <Portal />
    </LanguageProvider>
  );
}
