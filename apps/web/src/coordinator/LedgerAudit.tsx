import { fmtM3, fmtPct, fmtTime } from "./format";
import type { Lang } from "./i18n";
import { strings } from "./i18n";
import type { LedgerView } from "./mock";

interface Props {
  lang: Lang;
  ledger: LedgerView | null;
  findings: { severity: string; text: string }[];
  summaryEn: string;
  summaryTe: string;
}

export default function LedgerAudit({ lang, ledger, findings, summaryEn, summaryTe }: Props) {
  const t = strings[lang];
  if (!ledger) return <p role="status">{t.loading}</p>;
  const summary = lang === "te" && summaryTe ? summaryTe : summaryEn;

  return (
    <section aria-labelledby="ledger-h">
      <h3 id="ledger-h">{t.ledgerTitle}</h3>
      <p className="muted">{t.ledgerSub}</p>
      <ul className="stat-grid">
        <li><span>{t.ledgerSupply}</span><strong>{fmtM3(ledger.canalSupplyM3)}</strong></li>
        <li><span>{t.ledgerBuffer}</span><strong>{fmtM3(ledger.bufferM3)}</strong></li>
        <li><span>{t.ledgerLosses}</span><strong>{fmtM3(ledger.conveyanceLossesM3)}</strong></li>
        <li><span>{t.ledgerGini}</span><strong>{ledger.gini.toFixed(2)}</strong></li>
      </ul>
      <p role="status" className={ledger.conservationOk ? "ok-text" : "bad-text"}>
        {ledger.conservationOk ? t.ledgerConservationOk : t.ledgerConservationFail} ✓
      </p>
      <div className="table-wrap">
        <table>
          <caption>Farmer balances</caption>
          <thead>
            <tr><th scope="col">Farmer</th><th scope="col">{t.ledgerQuota}</th><th scope="col">{t.ledgerDelivered}</th><th scope="col">{t.ledgerNeedMet}</th></tr>
          </thead>
          <tbody>
            {ledger.farmers.map((f) => (
              <tr key={f.farmerId}>
                <th scope="row">{f.name}</th>
                <td>{fmtM3(f.quotaM3)}</td>
                <td>{fmtM3(f.deliveredM3)}</td>
                <td>{fmtPct(f.needMetPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{t.ledgerEntries}</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">At</th><th scope="col">From → To</th><th scope="col">Volume</th></tr>
          </thead>
          <tbody>
            {ledger.entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtTime(e.at)}</td>
                <th scope="row" className="flow">{e.from} → {e.to}<span className="sub">{e.reason}</span></th>
                <td>{fmtM3(e.volumeM3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{t.auditFindings}</h4>
      <ul>
        {findings.map((f, i) => (
          <li key={i}><span className={`pill ${f.severity === "warn" ? "warn" : f.severity === "critical" ? "crit" : "ok"}`}>{f.severity}</span> {f.text}</li>
        ))}
      </ul>
      <h4>{t.auditSummary}</h4>
      <p>{summary}</p>
    </section>
  );
}
