import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useTheme } from "../theme/ThemeContext";
import EntitlementReview from "./EntitlementReview";
import LedgerAudit from "./LedgerAudit";
import RequestQueue from "./RequestQueue";
import RosterCompare from "./RosterCompare";
import VerifyRegistrations from "./VerifyRegistrations";
import { api, type Source } from "./api";
import { strings } from "./i18n";
import type { EntitlementRow, FarmerRegistration, LedgerView, RequestRow, RosterProposal } from "./types";
import "./coordinator.css";

type Tab = "verify" | "entitlements" | "roster" | "requests" | "ledger";

const TABS: Tab[] = ["verify", "entitlements", "roster", "requests", "ledger"];

export default function CoordinatorConsole() {
  const { lang } = useI18n();
  const dark = useTheme().theme === "dark";
  const [tab, setTab] = useState<Tab>("verify");
  const [source, setSource] = useState<Source>("mock");
  const [loadError, setLoadError] = useState(false);

  const [farmers, setFarmers] = useState<FarmerRegistration[]>([]);
  const [ents, setEnts] = useState<EntitlementRow[]>([]);
  const [seasonTotal, setSeasonTotal] = useState(0);
  const [explEn, setExplEn] = useState("");
  const [explTe, setExplTe] = useState("");
  const [water, setWater] = useState<RosterProposal | null>(null);
  const [hours, setHours] = useState<RosterProposal | null>(null);
  const [activeRoster, setActiveRoster] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [findings, setFindings] = useState<{ severity: "info" | "warn" | "critical"; text: string }[]>([]);
  const [sumEn, setSumEn] = useState("");
  const [sumTe, setSumTe] = useState("");
  const [ready, setReady] = useState(false);

  const t = strings[lang];

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [f, e, rw, rq, lg, au] = await Promise.all([
          api.listFarmers(),
          api.suggestEntitlements(),
          api.proposeRoster("equal_water"),
          api.listRequests(),
          api.ledger(),
          api.audit(),
        ]);
        if (cancelled) return;
        setFarmers(f.rows);
        setEnts(e.rows);
        setSeasonTotal(e.seasonTotalM3);
        setExplEn(e.explanationEn);
        setExplTe(e.explanationTe);
        setWater(rw.proposal);
        setRequests(rq.rows);
        setLedger(lg.balances);
        setFindings(au.findings.map((x) => ({ severity: x.severity, text: x.text })));
        setSumEn(au.summaryEn);
        setSumTe(au.summaryTe);
        const sources = [f.source, e.source, rw.source, rq.source, lg.source, au.source];
        setSource(sources.every((s) => s === "live") ? "live" : "mock");
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const onVerified = useCallback((id: string) => {
    setFarmers((rows) => rows.map((r) => (r.farmer.id === id ? { ...r, verified: true } : r)));
  }, []);

  const onEntsApproved = useCallback((rows: EntitlementRow[]) => {
    setEnts(rows);
  }, []);

  const onProposed = useCallback((p: RosterProposal) => {
    if (p.mode === "equal_water") setWater(p);
    else setHours(p);
  }, []);

  const onRosterApproved = useCallback((id: string) => {
    setActiveRoster(id);
  }, []);

  const onDecided = useCallback((id: string, decision: "approve" | "reject", volumeM3: number) => {
    setRequests((rows) => rows.map((r) => (r.id === id ? { ...r, decision: { decision, volumeM3 }, status: decision === "approve" ? "approved" : "rejected" } : r)));
  }, []);

  function tabLabel(k: Tab): string {
    if (k === "verify") return t.tabVerify;
    if (k === "entitlements") return t.tabEntitlements;
    if (k === "roster") return t.tabRoster;
    if (k === "requests") return t.tabRequests;
    return t.tabLedger;
  }

  return (
    <div className={`coord ${dark ? "dark" : ""}`} data-theme={dark ? "dark" : "light"}>
      <a className="skip" href="#coord-main">{t.skipLink}</a>
      <header className="coord-head">
        <div>
          <h2>{t.consoleTitle}</h2>
          <p className="muted">{t.consoleSub}</p>
        </div>
        <div className="head-actions">
          <span className={`pill ${source === "live" ? "ok" : "warn"}`} role="status">
            {source === "live" ? t.onlineBadge : t.offlineBadge}
          </span>
        </div>
      </header>

      <nav aria-label={t.consoleTitle}>
        <ul className="tabs" role="tablist">
          {TABS.map((k) => (
            <li key={k} role="presentation">
              <button
                type="button" role="tab" aria-selected={tab === k}
                className={`tab ${tab === k ? "active" : ""}`}
                onClick={() => setTab(k)}
              >
                {tabLabel(k)}
                {k === "verify" && farmers.some((r) => !r.verified) && (
                  <span className="count" aria-label={`${String(farmers.filter((r) => !r.verified).length)} pending`}>
                    {farmers.filter((r) => !r.verified).length}
                  </span>
                )}
                {k === "requests" && requests.some((r) => !r.decision) && (
                  <span className="count" aria-label={`${String(requests.filter((r) => !r.decision).length)} pending`}>
                    {requests.filter((r) => !r.decision).length}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div id="coord-main" tabIndex={-1}>
        {!ready ? (
          <p role="status" aria-live="polite">{t.loading}</p>
        ) : (
          <>
            {loadError && <p role="alert" className="alert">{t.error}</p>}
            {tab === "verify" && <VerifyRegistrations lang={lang} rows={farmers} onVerified={onVerified} />}
            {tab === "entitlements" && (
              <EntitlementReview lang={lang} rows={ents} seasonTotalM3={seasonTotal} explanationEn={explEn} explanationTe={explTe} onApproved={onEntsApproved} />
            )}
            {tab === "roster" && (
              <RosterCompare lang={lang} water={water} hours={hours} activeId={activeRoster} onProposed={onProposed} onApproved={onRosterApproved} />
            )}
            {tab === "requests" && <RequestQueue lang={lang} rows={requests} onDecided={onDecided} />}
            {tab === "ledger" && <LedgerAudit lang={lang} ledger={ledger} findings={findings} summaryEn={sumEn} summaryTe={sumTe} />}
          </>
        )}
      </div>
    </div>
  );
}
