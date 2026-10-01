import { useEffect, useState } from "react";
import type { WaterRequest } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import type { FarmerApi } from "./farmerApi";
import { statusTone } from "./status";

/** The shared pool: every request for pool water and what the coordinator decided. Visible to all farmers. */
export default function SharedPool({
  api,
  farmerName,
  refreshKey,
}: {
  api: FarmerApi;
  farmerName: (id: string) => string;
  refreshKey: number;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const [requests, setRequests] = useState<WaterRequest[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRequests(null);
    setError(false);
    api
      .listRequests()
      .then((all) => {
        if (!cancelled) setRequests(all.filter((r) => r.type === "buffer"));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey]);

  return (
    <section aria-labelledby="pool-title">
      <div className="pool-head">
        <h2 className="card-title" id="pool-title">{t("pool.title")}</h2>
        <p className="card-sub">{t("pool.intro")}</p>
        <UnitHint />
      </div>
      {error && <p className="notice notice-crit" role="alert">{t("common.loadError")}</p>}
      {!error && !requests && <p className="muted" role="status">{t("common.loading")}</p>}
      {requests && requests.length === 0 && <EmptyState title={t("pool.emptyTitle")} body={t("pool.emptyBody")} />}
      {requests && requests.length > 0 && (
        <ul className="grid grid-halves pool-list">
          {requests.map((r) => {
            const decided = r.coordinator_decision;
            return (
              <li className="card" key={r.id}>
                <div className="row-between">
                  <strong>{farmerName(r.farmer_id)}</strong>
                  <span className={`pill pill-${statusTone(r.status)}`}>{t(`reqStatus.${r.status}`)}</span>
                </div>
                <p className="big-number small-number">{t("pool.asked", { m3: f.m3(r.volume_m3) })}</p>
                <p className="muted small">{f.dateTime(r.raised_at)}</p>
                <p>{t("pool.reason", { reason: r.reason })}</p>
                <p className="small">
                  {decided
                    ? t(decided.decision === "approve" ? "pool.decisionApproved" : "pool.decisionRejected", { m3: f.m3(decided.volume_m3) })
                    : t("pool.waiting")}
                  {decided?.note ? ` ${t("pool.note", { note: decided.note })}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
