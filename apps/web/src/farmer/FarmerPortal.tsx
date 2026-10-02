import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Outlet } from "@jadal/contracts";
import { api as sharedApi } from "../api";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import type { FarmerApi, FarmerDirectoryEntry } from "./farmerApi";
import { createFarmerApi } from "./farmerApi";
import RegistrationForm from "./RegistrationForm";
import MyWater from "./MyWater";
import AskWater from "./AskWater";
import SharedPool from "./SharedPool";
import "./farmer.css";

type Tab = "mywater" | "ask" | "pool" | "register";
const TABS: Tab[] = ["mywater", "ask", "pool", "register"];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

export default function FarmerPortal() {
  const { t } = useI18n();
  const api: FarmerApi = useMemo(() => createFarmerApi(), []);
  const [params, setParams] = useSearchParams();
  const [directory, setDirectory] = useState<FarmerDirectoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [farmerId, setFarmerId] = useState<string>("");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const requested = params.get("tab");
  const tab: Tab = isTab(requested) ? requested : "mywater";
  const setTab = useCallback(
    (next: Tab) => {
      setParams(next === "mywater" ? {} : { tab: next }, { replace: true });
    },
    [setParams],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .listFarmers()
      .then((d) => {
        if (cancelled) return;
        setDirectory(d);
        const first = d.find((e) => e.verified);
        if (first) setFarmerId((current) => current || first.farmer.id);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    sharedApi
      .canal()
      .then((c) => {
        if (!cancelled) setOutlets(c.outlets);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = (directory ?? []).filter((e) => e.verified);
  const entry = verified.find((e) => e.farmer.id === farmerId) ?? null;
  const farmerName = (id: string) => directory?.find((e) => e.farmer.id === id)?.farmer.name ?? t("farmer.someone");
  const needsFarmer = tab === "mywater" || tab === "ask";

  return (
    <div className="farmer-portal">
      <PageHeader eyebrow={t("page.farmer.eyebrow")} title={t("page.farmer.title")} lead={t("page.farmer.lead")} />

      {failed && (
        <div className="notice notice-crit" role="alert">
          <p>
            {t("common.loadError")}{" "}
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </button>
          </p>
        </div>
      )}

      <div className="farmer-bar">
        <div className="tabs" role="tablist" aria-label={t("page.farmer.title")}>
          {TABS.map((tb) => (
            <button key={tb} type="button" role="tab" className="tab" aria-selected={tab === tb} onClick={() => setTab(tb)}>
              {t(`farmer.tabs.${tb}`)}
            </button>
          ))}
        </div>
        {needsFarmer && verified.length > 0 && (
          <div className="farmer-picker">
            <label htmlFor="farmer-select">{t("farmer.showingFor")}</label>
            <select id="farmer-select" value={farmerId} onChange={(e) => setFarmerId(e.target.value)}>
              {verified.map((e) => (
                <option key={e.farmer.id} value={e.farmer.id}>
                  {e.farmer.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div role="tabpanel">
        {tab === "mywater" && <MyWater api={api} farmerId={farmerId} entry={entry} outlets={outlets} onAsk={() => setTab("ask")} />}
        {tab === "ask" && (
          <AskWater
            api={api}
            farmerId={farmerId}
            farmerName={entry?.farmer.name ?? ""}
            cropPlans={entry?.cropPlans ?? []}
            refreshKey={refreshKey}
            onRaised={() => setRefreshKey((k) => k + 1)}
          />
        )}
        {tab === "pool" && <SharedPool api={api} farmerName={farmerName} refreshKey={refreshKey} />}
        {tab === "register" && <RegistrationForm api={api} outlets={outlets} />}
      </div>
    </div>
  );
}
