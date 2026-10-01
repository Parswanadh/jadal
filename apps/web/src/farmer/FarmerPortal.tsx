import { useEffect, useMemo, useState } from "react";
import type { Outlet } from "@jadal/contracts";
import { api as sharedApi } from "../api";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import type { FarmerApi, FarmerDirectoryEntry } from "./farmerApi";
import { createFarmerApi } from "./farmerApi";
import RegistrationForm from "./RegistrationForm";
import MyWater from "./MyWater";
import UrgentRequestForm from "./UrgentRequestForm";
import BufferBoard from "./BufferBoard";
import "./farmer.css";

type Tab = "register" | "mywater" | "urgent" | "buffer";
const TABS: Tab[] = ["register", "mywater", "urgent", "buffer"];

function Portal() {
  const { t } = useI18n();
  const api: FarmerApi = useMemo(() => createFarmerApi(), []);
  const [directory, setDirectory] = useState<FarmerDirectoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [farmerId, setFarmerId] = useState<string>("f1");
  const [tab, setTab] = useState<Tab>("mywater");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
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

  const entry = directory?.find((e) => e.farmer.id === farmerId) ?? null;
  const farmerName = (id: string) => directory?.find((e) => e.farmer.id === id)?.farmer.name ?? id;

  return (
    <div className="farmer-portal">
      <div className="fp-container">
        <PageHeader
          eyebrow={t("page.farmer.eyebrow")}
          title={t("page.farmer.title")}
          lead={t("page.farmer.lead")}
          actions={
            <span className={`chip ${api.source === "mock" ? "chip-warn" : "chip-ok"}`} aria-live="polite">
              {api.source === "mock" ? t("app.offlineNote") : t("app.liveNote")}
            </span>
          }
        />

        <div className="fp-body">
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

        <nav className="fp-tabs" aria-label={t("page.farmer.title")}>
          {TABS.map((tb) => (
            <button key={tb} type="button" className="fp-tab" aria-selected={tab === tb} onClick={() => setTab(tb)}>
              {t(`tab.${tb}`)}
            </button>
          ))}
        </nav>

        <main>
          {tab === "register" && <RegistrationForm api={api} outlets={outlets} />}
          {tab === "mywater" && <MyWater api={api} farmerId={farmerId} />}
          {tab === "urgent" && (
            <UrgentRequestForm api={api} farmerId={farmerId} cropPlans={entry?.cropPlans ?? []} onRaised={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === "buffer" && <BufferBoard api={api} farmerName={farmerName} refreshKey={refreshKey} />}
        </main>
        </div>
      </div>
    </div>
  );
}

export default function FarmerPortal() {
  return <Portal />;
}
