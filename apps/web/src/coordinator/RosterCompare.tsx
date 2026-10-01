import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import type { Formatter } from "../lib/useFormat";
import ConfirmAction from "../components/ConfirmAction";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import { api } from "./api";
import type { RosterProposal } from "./types";

interface Props {
  water: RosterProposal | null;
  hours: RosterProposal | null;
  onApproved: (id: string) => void;
  onReload: () => void;
}

interface OptionProps {
  plan: RosterProposal;
  mode: "equal_water" | "equal_hours";
  gini: number;
  recommended: boolean;
  anyApproved: boolean;
  f: Formatter;
  onApprove: (plan: RosterProposal) => Promise<void>;
}

function Option({ plan, mode, gini, recommended, anyApproved, f, onApprove }: OptionProps) {
  const { t } = useI18n();
  const tail = plan.turns[plan.turns.length - 1];
  return (
    <section className="card roster-option" aria-labelledby={`roster-${mode}`}>
      <div className="row-between">
        <h3 className="card-title" id={`roster-${mode}`}>{t(`coord.roster.${mode}.title`)}</h3>
        {recommended && <span className="pill pill-ok">{t("coord.roster.recommended")}</span>}
        {plan.approved && <span className="pill pill-ok">{t("coord.roster.approvedPill")}</span>}
      </div>
      <p className="muted">{t(`coord.roster.${mode}.body`)}</p>
      <dl className="facts">
        {tail && (
          <div>
            <dt>{t("coord.roster.tailGets")}</dt>
            <dd className="num">{f.pct(tail.needMetPct)}</dd>
          </div>
        )}
        <div>
          <dt>{t("coord.roster.gap")}</dt>
          <dd className="num">{f.num(gini, 2)}</dd>
        </div>
      </dl>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{t(`coord.roster.${mode}.title`)}</caption>
          <thead>
            <tr>
              <th scope="col">{t("coord.col.outlet")}</th>
              <th scope="col">{t("coord.col.turn")}</th>
              <th scope="col" className="col-num">{t("coord.col.water")}</th>
              <th scope="col">{t("coord.col.needMet")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.turns.map((x) => (
              <tr key={x.id}>
                <th scope="row">
                  {f.outlet(x.outletName)}
                  <span className="sub">{x.farmerName}</span>
                </th>
                <td>
                  {f.range(x.start, x.end)}
                  <span className="sub">{f.turnLength(x.start, x.end)}</span>
                </td>
                <td className="num">{f.m3(x.plannedVolumeM3)}</td>
                <td className="num">
                  <span className="meter" role="img" aria-label={t("coord.roster.needMetLabel", { pct: f.pct(x.needMetPct) })}>
                    <span className="meter-fill" style={{ width: `${String(Math.min(100, x.needMetPct))}%` }} />
                  </span>
                  {f.pct(x.needMetPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <ConfirmAction
          variant={recommended ? "primary" : "default"}
          label={t(`coord.roster.${mode}.approve`)}
          question={t("coord.roster.approveQuestion", { n: plan.turns.length })}
          confirmLabel={t("coord.roster.approveYes")}
          onConfirm={() => onApprove(plan)}
          disabled={anyApproved}
        />
      </div>
    </section>
  );
}

export default function RosterCompare({ water, hours, onApproved, onReload }: Props) {
  const { t } = useI18n();
  const f = useFormat();
  const [calls, setCalls] = useState<number | null>(null);

  if (!water || !hours) {
    return (
      <section aria-labelledby="roster-h">
        <h2 className="card-title" id="roster-h">{t("coord.roster.title")}</h2>
        <EmptyState
          title={t("coord.roster.emptyTitle")}
          body={t("coord.roster.emptyBody")}
          action={
            <button type="button" className="btn btn-primary" onClick={onReload}>
              {t("coord.roster.emptyAction")}
            </button>
          }
        />
      </section>
    );
  }

  async function approve(plan: RosterProposal): Promise<void> {
    const queued = await api.approveRoster(plan.id);
    setCalls(queued);
    onApproved(plan.id);
  }

  const tailWater = water.turns[water.turns.length - 1];
  const tailHours = hours.turns[hours.turns.length - 1];
  const anyApproved = water.approved || hours.approved;
  const giniWater = water.equalWaterGini;
  const giniHours = hours.equalHoursGini;

  return (
    <section aria-labelledby="roster-h">
      <h2 className="card-title" id="roster-h">{t("coord.roster.title")}</h2>
      <p className="card-sub">{t("coord.roster.sub")}</p>
      <p className="roster-window">
        <strong>{t("coord.roster.window")}</strong> {t("coord.roster.windowRange", { start: f.dateTime(water.windowStart), end: f.dateTime(water.windowEnd) })}
      </p>
      {tailWater && tailHours && (
        <p className="roster-headline">
          {t("coord.roster.headline", { water: f.pct(tailWater.needMetPct), hours: f.pct(tailHours.needMetPct) })}
        </p>
      )}
      {anyApproved && (
        <div className="notice notice-ok" role="status">
          <p>{calls === null ? t("coord.roster.approvedAlready") : t("coord.roster.approvedNotice", { n: calls })}</p>
        </div>
      )}
      <div className="grid grid-halves">
        <Option plan={water} mode="equal_water" gini={giniWater} recommended={giniWater < giniHours} anyApproved={anyApproved} f={f} onApprove={approve} />
        <Option plan={hours} mode="equal_hours" gini={giniHours} recommended={false} anyApproved={anyApproved} f={f} onApprove={approve} />
      </div>
      <UnitHint />
    </section>
  );
}
