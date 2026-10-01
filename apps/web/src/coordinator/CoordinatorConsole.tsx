import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import EntitlementReview from "./EntitlementReview";
import LedgerAudit from "./LedgerAudit";
import RequestQueue from "./RequestQueue";
import RosterCompare from "./RosterCompare";
import VerifyRegistrations from "./VerifyRegistrations";
import { api } from "./api";
import type { AuditView, EntitlementRow, FarmerRegistration, LedgerView, RequestRow, RosterProposal } from "./types";
import "./coordinator.css";

type Tab = "requests" | "farmers" | "entitlements" | "roster" | "accounts";

const TABS: Tab[] = ["requests", "farmers", "entitlements", "roster", "accounts"];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

export default function CoordinatorConsole() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [chosen, setChosen] = useState<Tab | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);

  const [farmers, setFarmers] = useState<FarmerRegistration[]>([]);
  const [ents, setEnts] = useState<EntitlementRow[]>([]);
  const [seasonTotal, setSeasonTotal] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [water, setWater] = useState<RosterProposal | null>(null);
  const [hours, setHours] = useState<RosterProposal | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [audit, setAudit] = useState<AuditView | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [f, e, rw, rh, rq, lg, au] = await Promise.all([
        api.listFarmers(),
        api.suggestEntitlements(),
        api.proposeRoster("equal_water"),
        api.proposeRoster("equal_hours"),
        api.listRequests(),
        api.ledger(),
        api.audit(),
      ]);
      setFarmers(f);
      setEnts(e.rows);
      setSeasonTotal(e.seasonTotalM3);
      setExplanation(e.explanation);
      setWater(rw);
      setHours(rh);
      setRequests(rq);
      setLedger(lg);
      setAudit(au);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingRequests = requests.filter((r) => !r.decision).length;
  const pendingFarmers = farmers.filter((r) => !r.verified).length;
  const pendingEnts = ents.filter((r) => r.status === "proposed").length;
  const rosterOpen = water !== null && hours !== null && !water.approved && !hours.approved ? 1 : 0;
  const counts: Record<Tab, number> = {
    requests: pendingRequests,
    farmers: pendingFarmers,
    entitlements: pendingEnts,
    roster: rosterOpen,
    accounts: 0,
  };

  // Open on what needs attention first: extra-water requests, then unchecked
  // farmers, then the weekly shares. Fall back to the weekly shares.
  const fromUrl = params.get("tab");
  const defaultTab: Tab =
    pendingRequests > 0 ? "requests" : pendingFarmers > 0 ? "farmers" : "entitlements";
  const tab: Tab = isTab(fromUrl) ? fromUrl : (chosen ?? defaultTab);

  const pick = useCallback(
    (next: Tab) => {
      setChosen(next);
      if (params.has("tab")) setParams({}, { replace: true });
    },
    [params, setParams],
  );

  const onVerified = useCallback((id: string) => {
    setFarmers((rows) => rows.map((r) => (r.farmer.id === id ? { ...r, verified: true } : r)));
  }, []);

  const onDecided = useCallback((id: string, decision: "approve" | "reject", volumeM3: number) => {
    setRequests((rows) =>
      rows.map((r) => (r.id === id ? { ...r, decision: { decision, volumeM3 }, status: decision === "approve" ? "approved" : "rejected" } : r)),
    );
  }, []);

  const onRosterApproved = useCallback((id: string) => {
    const mark = (p: RosterProposal | null): RosterProposal | null => (p && p.id === id ? { ...p, approved: true } : p);
    setWater(mark);
    setHours(mark);
  }, []);

  const tabLabel = useMemo(() => (k: Tab) => t(`coord.tabs.${k}`), [t]);

  return (
    <div className="coord">
      <PageHeader eyebrow={t("page.coordinator.eyebrow")} title={t("page.coordinator.title")} lead={t("page.coordinator.lead")} />

      <div className="tabs" role="tablist" aria-label={t("page.coordinator.title")}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => pick(k)}>
            {tabLabel(k)}
            {counts[k] > 0 && (
              <span className="tab-badge" aria-label={t("coord.pendingCount", { n: counts[k] })}>
                {counts[k]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="coord-main">
        {!ready ? (
          <p className="muted" role="status">{t("common.loading")}</p>
        ) : (
          <>
            {loadError && (
              <div className="notice notice-crit" role="alert">
                <p>
                  {t("common.loadError")}{" "}
                  <button type="button" className="btn" onClick={() => void load()}>
                    {t("common.retry")}
                  </button>
                </p>
              </div>
            )}
            {tab === "requests" && <RequestQueue rows={requests} onDecided={onDecided} />}
            {tab === "farmers" && <VerifyRegistrations rows={farmers} onVerified={onVerified} />}
            {tab === "entitlements" && (
              <EntitlementReview
                rows={ents}
                seasonTotalM3={seasonTotal}
                explanation={explanation}
                onApproved={setEnts}
                onGoFarmers={() => pick("farmers")}
                onReload={() => void load()}
              />
            )}
            {tab === "roster" && <RosterCompare water={water} hours={hours} onApproved={onRosterApproved} onReload={() => void load()} />}
            {tab === "accounts" && <LedgerAudit ledger={ledger} audit={audit} />}
          </>
        )}
      </div>
    </div>
  );
}
