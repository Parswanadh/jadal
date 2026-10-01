import { useEffect, useState } from "react";
import type { WaterRequest } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import type { FarmerApi } from "./farmerApi";

/** Public buffer board: every buffer request plus its decision. Display only. */

function pillClass(status: WaterRequest["status"]): string {
  if (status === "approved" || status === "delivered" || status === "confirmed" || status === "scheduled" || status === "released")
    return "fp-pill fp-pill-ok";
  if (status === "rejected" || status === "cancelled" || status === "expired") return "fp-pill fp-pill-bad";
  return "fp-pill fp-pill-pending";
}

export default function BufferBoard({
  api,
  farmerName,
  refreshKey,
}: {
  api: FarmerApi;
  farmerName: (id: string) => string;
  refreshKey: number;
}) {
  const { t } = useI18n();
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
    <section className="fp-card" aria-labelledby="fp-buf-title">
      <h2 id="fp-buf-title">{t("buffer.title")}</h2>
      <p>{t("buffer.intro")}</p>
      {error && <p className="fp-error">{t("app.error")}</p>}
      {!error && !requests && <p aria-live="polite">{t("app.loading")}</p>}
      {requests && requests.length === 0 && <p>{t("buffer.empty")}</p>}
      {requests &&
        requests.map((r) => {
          const decided = r.coordinator_decision;
          const decisionText = decided
            ? `${decided.decision === "approve" ? t("buffer.approved") : t("buffer.rejected")} · ${decided.volume_m3} ${t("app.unitM3")}${decided.note ? ` · ${t("buffer.notePrefix")} ${decided.note}` : ""}`
            : t("buffer.pending");
          return (
            <article className="fp-req" key={r.id} aria-label={`${farmerName(r.farmer_id)} · ${r.volume_m3}`}>
              <div className="fp-req-head">
                <strong>{farmerName(r.farmer_id)}</strong>
                <span className={pillClass(r.status)}>{t(`reqStatus.${r.status}`)}</span>
              </div>
              <dl>
                <div className="fp-stat">
                  <dt>{t("buffer.colVolume")}</dt>
                  <dd>
                    {r.volume_m3.toLocaleString("en-IN")} {t("app.unitM3")}
                  </dd>
                </div>
                <div className="fp-stat">
                  <dt>{t("buffer.colReason")}</dt>
                  <dd>{r.reason}</dd>
                </div>
                <div className="fp-stat">
                  <dt>{t("buffer.colDecision")}</dt>
                  <dd>{decisionText}</dd>
                </div>
              </dl>
            </article>
          );
        })}
    </section>
  );
}
