import { useState } from "react";
import { api } from "./api";
import { fmtM3 } from "./format";
import type { Lang } from "./i18n";
import { strings } from "./i18n";
import type { RequestRow } from "./types";

interface Props {
  lang: Lang;
  rows: RequestRow[];
  onDecided: (id: string, decision: "approve" | "reject", volumeM3: number) => void;
}

function urgencyClass(s: number): string {
  if (s >= 0.75) return "crit";
  if (s >= 0.5) return "warn";
  return "ok";
}

export default function RequestQueue({ lang, rows, onDecided }: Props) {
  const t = strings[lang];
  const [grants, setGrants] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function grantFor(r: RequestRow): number {
    return grants[r.id] ?? r.recommendation.volumeM3;
  }

  async function decide(r: RequestRow, decision: "approve" | "reject"): Promise<void> {
    const vol = decision === "approve" ? grantFor(r) : 0;
    setBusy(`${r.id}-${decision}`);
    try {
      await api.decideRequest(r.id, decision, vol);
      onDecided(r.id, decision, vol);
    } finally {
      setBusy(null);
    }
  }

  const pending = rows.filter((r) => !r.decision);

  return (
    <section aria-labelledby="req-h">
      <h3 id="req-h">{t.reqTitle}</h3>
      <p className="muted">{t.reqSub}</p>
      {pending.length === 0 ? (
        <p role="status">{t.reqEmpty}</p>
      ) : (
        <ul className="cards">
          {pending.map((r) => (
            <li key={r.id} className="card">
              <div className="card-head">
                <strong>{r.farmerName}</strong>
                <span className="pill">{t[`reqType_${r.type}` as keyof typeof t] as string} · {r.channel}</span>
              </div>
              <p><strong>{t.reqVolumeAsked}:</strong> {fmtM3(r.volumeM3)} · <strong>{t.reqUrgency}:</strong>{" "}
                <span className={`pill ${urgencyClass(r.triageScore)}`}>{r.triageScore.toFixed(2)}</span>
              </p>
              <p><strong>{t.reqReason}:</strong> {lang === "te" && r.reasonTe ? r.reasonTe : r.reason}</p>
              <details className="explain">
                <summary>{t.reqAgent}: {r.recommendation.decision} · {fmtM3(r.recommendation.volumeM3)}</summary>
                <p>{lang === "te" && r.recommendation.rationaleTe ? r.recommendation.rationaleTe : r.recommendation.rationale}</p>
              </details>
              <div className="grant-row">
                <label htmlFor={`grant-${r.id}`}>{t.reqVolumeGrant}</label>
                <input
                  id={`grant-${r.id}`}
                  className="num"
                  type="number"
                  min={0}
                  max={r.volumeM3}
                  step={5}
                  value={grantFor(r)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) setGrants((g) => ({ ...g, [r.id]: Math.round(n) }));
                  }}
                />
              </div>
              <div className="btn-row">
                <button
                  type="button" className="btn primary"
                  disabled={busy !== null}
                  onClick={() => void decide(r, "approve")}
                >
                  {busy === `${r.id}-approve` ? t.loading : `${t.reqApprove} · ${fmtM3(grantFor(r))}`}
                </button>
                <button
                  type="button" className="btn danger"
                  disabled={busy !== null}
                  onClick={() => void decide(r, "reject")}
                >
                  {busy === `${r.id}-reject` ? t.loading : t.reqReject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.some((r) => r.decision) && (
        <div className="table-wrap">
          <table>
            <caption>{t.reqDecided}</caption>
            <tbody>
              {rows.filter((r) => r.decision).map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.farmerName}</th>
                  <td className="text">{r.decision?.decision}</td>
                  <td>{r.decision ? fmtM3(r.decision.volumeM3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
