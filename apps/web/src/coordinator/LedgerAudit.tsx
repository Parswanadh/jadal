import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import type { AuditView, LedgerView } from "./types";

interface Props {
  ledger: LedgerView | null;
  audit: AuditView | null;
}

const SEVERITY_PILL = { info: "pill-ok", warn: "pill-warn", critical: "pill-crit" } as const;

export default function LedgerAudit({ ledger, audit }: Props) {
  const { t, lang } = useI18n();
  const f = useFormat();

  if (!ledger) {
    return (
      <section aria-labelledby="ledger-h">
        <h2 className="card-title" id="ledger-h">{t("coord.acc.title")}</h2>
        <EmptyState title={t("coord.acc.emptyTitle")} body={t("coord.acc.emptyBody")} />
      </section>
    );
  }

  const nameOf = new Map(ledger.farmers.map((x) => [x.farmerId, x.name]));
  function account(id: string): string {
    if (id === "canal_supply") return t("coord.acc.accountSupply");
    if (id === "buffer") return t("coord.acc.accountPool");
    if (id === "losses:conveyance") return t("coord.acc.accountLoss");
    const m = /^farmer:([^:]+):(quota|delivered)$/.exec(id);
    if (m?.[1] && m[2]) {
      const name = nameOf.get(m[1]) ?? t("farmer.someone");
      return t(m[2] === "quota" ? "coord.acc.accountQuota" : "coord.acc.accountDelivered", { name });
    }
    return id;
  }

  const summary = audit ? (lang === "te" && audit.summaryTe ? audit.summaryTe : audit.summaryEn) : "";

  return (
    <section aria-labelledby="ledger-h">
      <h2 className="card-title" id="ledger-h">{t("coord.acc.title")}</h2>
      <p className="card-sub">{t("coord.acc.sub")}</p>

      <ul className="stat-grid">
        <li><span>{t("coord.acc.supply")}</span><strong>{f.m3(ledger.canalSupplyM3)}</strong></li>
        <li><span>{t("coord.acc.pool")}</span><strong>{f.m3(ledger.bufferM3)}</strong></li>
        <li><span>{t("coord.acc.lost")}</span><strong>{f.m3(ledger.conveyanceLossesM3)}</strong></li>
        <li><span>{t("coord.acc.fairness")}</span><strong>{f.num(ledger.gini, 2)}</strong><em>{t("coord.acc.fairnessHint")}</em></li>
      </ul>
      <UnitHint />

      <div className={`notice ${ledger.conservationOk ? "notice-ok" : "notice-crit"}`} role="status">
        <p>{ledger.conservationOk ? t("coord.acc.balanced") : t("coord.acc.unbalanced")}</p>
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <div className="table-wrap">
            <table className="table">
              <caption>{t("coord.acc.farmersTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("coord.col.farmer")}</th>
                  <th scope="col" className="col-num">{t("coord.col.quota")}</th>
                  <th scope="col" className="col-num">{t("coord.col.delivered")}</th>
                  <th scope="col" className="col-num">{t("coord.col.needMet")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.farmers.map((x) => (
                  <tr key={x.farmerId}>
                    <th scope="row">{x.name}</th>
                    <td className="num">{f.m3(x.quotaM3)}</td>
                    <td className="num">{f.m3(x.deliveredM3)}</td>
                    <td className="col-num">{x.deliveredM3 > 0 ? <span className="num">{f.pct(x.needMetPct)}</span> : <span className="muted">{t("coord.acc.notStarted")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-wrap">
            <table className="table">
              <caption>{t("coord.acc.entriesTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("coord.col.when")}</th>
                  <th scope="col">{t("coord.col.moved")}</th>
                  <th scope="col" className="col-num">{t("coord.col.water")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">{t("coord.acc.noEntries")}</td>
                  </tr>
                )}
                {ledger.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{f.dateTime(e.at)}</td>
                    <th scope="row">
                      {t("coord.acc.moveLine", { from: account(e.from), to: account(e.to) })}
                      {lang === "en" && e.reason && <span className="sub">{e.reason}</span>}
                    </th>
                    <td className="num">{f.m3(e.volumeM3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="card">
          <h3 className="card-title">{t("coord.acc.auditTitle")}</h3>
          {summary ? <p>{summary}</p> : <p className="muted">{t("coord.acc.auditEmpty")}</p>}
          {lang === "en" && audit && audit.findings.length > 0 && (
            <details className="disclosure">
              <summary>{t("coord.acc.findings")}</summary>
              <ul className="findings">
                {audit.findings.map((x, i) => (
                  <li key={i}>
                    <span className={`pill ${SEVERITY_PILL[x.severity]}`}>{t(`coord.acc.severity.${x.severity}`)}</span> {x.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}
