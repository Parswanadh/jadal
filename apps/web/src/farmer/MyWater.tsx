import { useEffect, useState } from "react";
import type { Outlet } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import type { FarmerApi, FarmerDirectoryEntry, MyWaterView } from "./farmerApi";

interface Props {
  api: FarmerApi;
  farmerId: string;
  entry: FarmerDirectoryEntry | null;
  outlets: Outlet[];
  onAsk: () => void;
}

/** What a farmer cares about first: when is my turn, how much water this week, how much of the season is used. */
export default function MyWater({ api, farmerId, entry, outlets, onAsk }: Props) {
  const { t } = useI18n();
  const f = useFormat();
  const [view, setView] = useState<MyWaterView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!farmerId) return;
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

  if (!farmerId) {
    return <EmptyState title={t("mywater.noFarmerTitle")} body={t("mywater.noFarmerBody")} />;
  }
  if (error) return <p className="notice notice-crit" role="alert">{t("common.loadError")}</p>;
  if (!view) return <p className="muted" role="status">{t("common.loading")}</p>;

  const turn = view.next_turn;
  const outletName = (id: string) => f.outlet(outlets.find((o) => o.id === id)?.name ?? "");
  const hasShares = view.shares.length > 0;
  const single = view.shares.length === 1 ? view.shares[0] : undefined;

  return (
    <div className="stack">
      <section className="card turn-card" aria-labelledby="mw-turn">
        <p className="label-small" id="mw-turn">{t("mywater.nextTurn")}</p>
        {turn ? (
          <>
            <p className="turn-line">
              {t("mywater.turnLine", { when: f.range(turn.start, turn.end), outlet: f.outlet(turn.outlet_name) })}
            </p>
            <p className="turn-status">
              <span className={`pill ${turn.approved ? "pill-ok" : "pill-warn"}`}>
                {turn.approved ? t("mywater.turnConfirmed") : t("mywater.turnPlanned")}
              </span>
            </p>
            <p className="muted">{t("mywater.turnWater", { m3: f.m3(turn.planned_volume_m3) })}</p>
            <p className="muted">
              {single ? t("mywater.turnWhyShare", { share: f.m3(single.volume_m3) }) : t("mywater.turnWhyNoShare")}
            </p>
            <UnitHint />
          </>
        ) : (
          <EmptyState title={t("mywater.noTurnTitle")} body={t("mywater.noTurnBody")} />
        )}
      </section>

      <div className="grid grid-halves">
        <section className="card" aria-labelledby="mw-week">
          <p className="label-small" id="mw-week">{t("mywater.thisWeek")}</p>
          {!hasShares && <EmptyState title={t("mywater.noShareTitle")} body={t("mywater.noShareBody")} />}
          {single && (
            <>
              <p className="big-number">{t("mywater.planned", { m3: f.m3(single.volume_m3) })}</p>
              <p className="muted">{t(`mywater.shareStatus.${single.status}`)}</p>
              <p>{t("mywater.need", { mm: f.num(single.net_irrigation_mm, 1) })}</p>
              <p className="muted small">{t("mywater.mmHelp")}</p>
            </>
          )}
          {hasShares && !single && (
            <>
              <ul className="plain-list">
                {view.shares.map((s) => (
                  <li key={s.crop_plan_id}>
                    <strong>{f.crop(s.crop)}</strong>
                    <span className="big-number small-number">{t("mywater.planned", { m3: f.m3(s.volume_m3) })}</span>
                    <span className="muted small">{t("mywater.needCrop", { mm: f.num(s.net_irrigation_mm, 1) })}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">{t("mywater.mmHelp")}</p>
            </>
          )}
          {view.week_start && <p className="muted small">{t("mywater.weekOf", { day: f.day(`${view.week_start}T12:00:00+05:30`) })}</p>}
        </section>

        <section className="card" aria-labelledby="mw-season">
          <p className="label-small" id="mw-season">{t("mywater.season")}</p>
          {view.quota_m3 === null ? (
            <EmptyState title={t("mywater.noQuotaTitle")} body={t("mywater.noQuotaBody")} />
          ) : (
            <>
              <p className="big-number">{t("mywater.quotaUsed", { used: f.m3(view.delivered_m3), quota: f.m3(view.quota_m3) })}</p>
              <progress className="bar" value={view.delivered_m3} max={view.quota_m3} aria-label={t("mywater.season")} />
              {view.delivered_m3 > 0 ? (
                <p>{t("mywater.needMet", { pct: f.pct(view.need_met_pct) })}</p>
              ) : (
                <p className="muted">{t("mywater.notStarted")}</p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid grid-halves">
        <section className="card" aria-labelledby="mw-land">
          <h2 className="card-title" id="mw-land">{t("mywater.land")}</h2>
          {entry && entry.plots.length > 0 ? (
            <ul className="plain-list">
              {entry.plots.map((p) => (
                <li key={p.id}>
                  <strong>{t("mywater.plotLine", { area: f.num(p.area_ha, 1), outlet: outletName(p.outlet_id) })}</strong>
                  <span className="muted small">{f.soil(p.soil)}</span>
                  {entry.cropPlans
                    .filter((c) => c.plot_id === p.id)
                    .map((c) => (
                      <span key={c.id} className="small">
                        {t("mywater.cropLine", { crop: f.crop(c.crop), date: f.dateOnly(c.sowing_date) })}
                      </span>
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("mywater.noLandTitle")} body={t("mywater.noLandBody")} />
          )}
        </section>

        <section className="card" aria-labelledby="mw-ask">
          <h2 className="card-title" id="mw-ask">{t("mywater.askTitle")}</h2>
          <p className="muted">{t("mywater.askBody")}</p>
          <button type="button" className="btn btn-primary" onClick={onAsk}>
            {t("mywater.askButton")}
          </button>
        </section>
      </div>
    </div>
  );
}
