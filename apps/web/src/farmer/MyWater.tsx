import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { FarmerApi, MyWaterView } from "../api/client";

/** Display-only: every number is rendered exactly as the API/mock returned it. */
function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "te" ? "te-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MyWater({ api, farmerId }: { api: FarmerApi; farmerId: string }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<MyWaterView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError(false);
    api
      .getMyWater(farmerId)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, farmerId]);

  if (error) return <p className="fp-error">{t("app.error")}</p>;
  if (!view)
    return (
      <section className="fp-card" aria-live="polite">
        {t("app.loading")}
      </section>
    );

  return (
    <section className="fp-card" aria-labelledby="fp-mw-title">
      <h2 id="fp-mw-title">{t("mywater.title")}</h2>
      <p>{t("mywater.intro")}</p>
      <dl>
        <div className="fp-stat">
          <dt>{t("mywater.weekOf")}</dt>
          <dd>{view.week_start}</dd>
        </div>
        <div className="fp-stat">
          <dt>{t("mywater.entitlement")}</dt>
          <dd>
            {fmt(view.entitlement_m3)} {t("app.unitM3")}
          </dd>
        </div>
        <div className="fp-stat">
          <dt>{t("mywater.netDepth")}</dt>
          <dd>
            {fmt(view.net_irrigation_mm)} {t("app.unitMm")}
          </dd>
        </div>
        <div className="fp-stat">
          <dt>{t("mywater.nextTurn")}</dt>
          <dd>
            {view.next_turn
              ? `${view.next_turn.outlet_name} · ${fmtDateTime(view.next_turn.start, lang)} → ${fmtDateTime(view.next_turn.end, lang)}`
              : t("mywater.noTurn")}
          </dd>
        </div>
        {view.next_turn && (
          <div className="fp-stat">
            <dt>{t("mywater.turnVolume")}</dt>
            <dd>
              {fmt(view.next_turn.planned_volume_m3)} {t("app.unitM3")}
            </dd>
          </div>
        )}
        <div className="fp-stat">
          <dt>{t("mywater.delivered")}</dt>
          <dd>
            {fmt(view.delivered_m3)} {t("app.unitM3")}
          </dd>
        </div>
        <div className="fp-stat">
          <dt>{t("mywater.quota")}</dt>
          <dd>
            {fmt(view.quota_m3)} {t("app.unitM3")}
          </dd>
        </div>
        <div className="fp-stat">
          <dt>{t("mywater.needMet")}</dt>
          <dd>{view.need_met_pct}%</dd>
        </div>
      </dl>
    </section>
  );
}
