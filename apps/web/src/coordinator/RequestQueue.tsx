import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { fixtureText } from "../i18n/fixtureText";
import { useFormat } from "../lib/useFormat";
import ConfirmAction from "../components/ConfirmAction";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import AlertControl from "./AlertControl";
import { api } from "./api";
import type { RequestRow } from "./types";

interface Props {
  rows: RequestRow[];
  /** True while the queue is being re-read from the API. */
  loading: boolean;
  /** True when the last re-read failed. */
  failed: boolean;
  onRefresh: () => void;
  onDecided: (id: string, decision: "approve" | "reject", volumeM3: number) => void;
}

function urgencyLevel(score: number): "high" | "mid" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "mid";
  return "low";
}

const URGENCY_PILL = { high: "pill-crit", mid: "pill-warn", low: "pill-ok" } as const;

interface Decision {
  decision: "approve" | "reject";
  /** What the API said it dispatched, if anything. */
  dispatched: string | null;
}

export default function RequestQueue({ rows, loading, failed, onRefresh, onDecided }: Props) {
  const { t, lang } = useI18n();
  const f = useFormat();
  const [grants, setGrants] = useState<Record<string, number>>({});
  const [decideFailed, setDecideFailed] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  function grantFor(r: RequestRow): number {
    return grants[r.id] ?? r.recommendation?.volumeM3 ?? r.volumeM3;
  }

  async function decide(r: RequestRow, decision: "approve" | "reject"): Promise<void> {
    const volume = decision === "approve" ? grantFor(r) : 0;
    setDecideFailed(false);
    try {
      const res = await api.decideRequest(r.id, decision, volume);
      setDecisions((d) => ({ ...d, [r.id]: { decision, dispatched: res.dispatched } }));
      onDecided(r.id, decision, volume);
    } catch {
      setDecideFailed(true);
    }
  }

  const pending = rows.filter((r) => !r.decision);
  const decided = rows.filter((r) => r.decision);

  return (
    <section aria-labelledby="req-h">
      <h2 className="card-title" id="req-h">{t("coord.req.title")}</h2>
      <p className="card-sub">{t("coord.req.sub")}</p>

      <div className="btn-row req-toolbar">
        <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
          {t("coord.req.refresh")}
        </button>
        {loading && (
          <span className="muted small" role="status">
            {t("coord.req.loading")}
          </span>
        )}
      </div>

      {failed && (
        <div className="notice notice-crit" role="alert">
          <p>
            {t("common.loadError")}{" "}
            <button type="button" className="btn" onClick={onRefresh}>
              {t("common.retry")}
            </button>
          </p>
        </div>
      )}

      {decideFailed && (
        <div className="notice notice-crit" role="alert">
          <p>{t("coord.req.decideFailed")}</p>
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState title={t("coord.req.emptyTitle")} body={t("coord.req.emptyBody")} />
      ) : (
        <ul className="req-grid">
          {pending.map((r) => {
            const level = urgencyLevel(r.triageScore);
            const grant = grantFor(r);
            const deducted = r.type === "buffer" ? "coord.req.fromPool" : "coord.req.fromQuota";
            return (
              <li key={r.id} className="card req-card">
                <div className="row-between">
                  <strong>{r.farmerName}</strong>
                  <span className="pill">{t(`reqType.${r.type}`)}</span>
                </div>
                <p className="muted small">{t("coord.req.when", { when: f.dateTime(r.raisedAt), channel: f.channel(r.channel) })}</p>
                <p className="req-ask">
                  {t("coord.req.asks", { m3: f.m3(r.volumeM3) })}{" "}
                  <span className={`pill ${URGENCY_PILL[level]}`}>{t(`coord.urgency.${level}`)}</span>
                </p>
                <p className="req-reason">{t("coord.req.reason", { reason: fixtureText(r.reason, t) })}</p>
                {r.recommendation && (
                  <div className="req-suggest">
                    <p>
                      {t(`coord.req.suggest.${r.recommendation.decision}`, {
                        m3: f.m3(r.recommendation.volumeM3),
                        asked: f.m3(r.volumeM3),
                      })}
                    </p>
                    {lang === "en" && r.recommendation.rationale && <p className="muted small">{r.recommendation.rationale}</p>}
                  </div>
                )}
                <div className="field req-grant">
                  <label htmlFor={`grant-${r.id}`}>{t("coord.req.grantLabel")}</label>
                  <input
                    id={`grant-${r.id}`}
                    type="number"
                    min={0}
                    max={r.volumeM3}
                    step={5}
                    value={grant}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setGrants((g) => ({ ...g, [r.id]: Math.round(n) }));
                    }}
                  />
                </div>
                <div className="btn-row">
                  <ConfirmAction
                    variant="primary"
                    label={t("coord.req.approve", { m3: f.m3(grant) })}
                    question={t("coord.req.approveQuestion", { name: r.farmerName, m3: f.m3(grant), source: t(deducted) })}
                    confirmLabel={t("coord.req.approveYes")}
                    onConfirm={() => decide(r, "approve")}
                  />
                  <ConfirmAction
                    variant="danger"
                    label={t("coord.req.reject")}
                    question={t("coord.req.rejectQuestion", { name: r.farmerName })}
                    confirmLabel={t("coord.req.rejectYes")}
                    onConfirm={() => decide(r, "reject")}
                  />
                  <AlertControl farmerId={r.farmerId} farmerName={r.farmerName} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(pending.length > 0 || decided.length > 0) && <UnitHint />}

      {decided.length > 0 && (
        <div className="req-decided">
          <h3 className="section-title">{t("coord.req.decidedTitle")}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("coord.col.farmer")}</th>
                  <th scope="col">{t("coord.col.request")}</th>
                  <th scope="col" className="col-num">{t("coord.col.asked")}</th>
                  <th scope="col">{t("coord.col.result")}</th>
                  <th scope="col">{t("coord.col.alert")}</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.farmerName}</th>
                    <td>{t(`reqType.${r.type}`)}</td>
                    <td className="num">{f.m3(r.volumeM3)}</td>
                    <td>
                      {r.decision?.decision === "approve" ? (
                        <span className="pill pill-ok">{t("coord.req.resultApproved", { m3: f.m3(r.decision.volumeM3) })}</span>
                      ) : (
                        <span className="pill pill-crit">{t("coord.req.resultRejected")}</span>
                      )}
                      {r.decision?.decision === "approve" && (
                        <span className="muted small dispatch-note">
                          {decisions[r.id]?.dispatched
                            ? t("coord.req.dispatched", { channel: f.channel(decisions[r.id]?.dispatched ?? "") })
                            : t("coord.req.notDispatched")}
                        </span>
                      )}
                    </td>
                    {/* An approved request is exactly when the farmer needs to be
                        told their allocation, so the control lives here too. */}
                    <td>
                      <AlertControl farmerId={r.farmerId} farmerName={r.farmerName} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
