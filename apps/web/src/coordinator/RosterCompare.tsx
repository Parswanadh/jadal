import { useState } from "react";
import { ApiClientError } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import type { Formatter } from "../lib/useFormat";
import { fromLocalInputValue, toLocalInputValue } from "../lib/localTime";
import ConfirmAction from "../components/ConfirmAction";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import { api } from "./api";
import type { RosterProposal, TurnRow } from "./types";

interface Props {
  water: RosterProposal | null;
  hours: RosterProposal | null;
  /** `${rosterId}:${turnId}` for turns the coordinator has changed this session. */
  changedTurns: Set<string>;
  onApproved: (id: string) => void;
  onTurnSaved: (rosterId: string, turnId: string, start: string, end: string) => void;
  onReload: () => void;
}

interface OptionProps {
  plan: RosterProposal;
  mode: "equal_water" | "equal_hours";
  gini: number;
  recommended: boolean;
  anyApproved: boolean;
  changedTurns: Set<string>;
  f: Formatter;
  onApprove: (plan: RosterProposal) => Promise<void>;
  onTurnSaved: (rosterId: string, turnId: string, start: string, end: string) => void;
}

interface Draft {
  start: string;
  end: string;
}

function Option({ plan, mode, gini, recommended, anyApproved, changedTurns, f, onApprove, onTurnSaved }: OptionProps) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ start: "", end: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tail = plan.turns[plan.turns.length - 1];

  function beginEdit(turn: TurnRow): void {
    setEditingId(turn.id);
    setDraft({ start: toLocalInputValue(turn.start), end: toLocalInputValue(turn.end) });
    setError(null);
    setSavedId(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setError(null);
  }

  /** Turn a failed save into the clearest message available. */
  function saveError(err: unknown): string {
    if (err instanceof ApiClientError) {
      if (err.code === "backwards_times") return t("coord.roster.edit.backwards");
      if (err.code === "bad_times") return t("coord.roster.edit.invalid");
      if (err.message) return err.message;
    }
    return t("coord.roster.edit.error");
  }

  async function save(turn: TurnRow): Promise<void> {
    const start = fromLocalInputValue(draft.start);
    const end = fromLocalInputValue(draft.end);
    if (!start || !end) {
      setError(t("coord.roster.edit.invalid"));
      return;
    }
    // Validate before sending, then let the API have the final say.
    if (Date.parse(end) <= Date.parse(start)) {
      setError(t("coord.roster.edit.backwards"));
      return;
    }
    setBusyId(turn.id);
    setError(null);
    try {
      const saved = await api.updateTurn(plan.id, turn.id, start, end);
      onTurnSaved(plan.id, turn.id, saved.start, saved.end);
      setSavedId(turn.id);
      setEditingId(null);
    } catch (err) {
      setError(saveError(err));
    } finally {
      setBusyId(null);
    }
  }

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

      {savedId && (
        <div className="notice notice-ok" role="status">
          <p>{t("coord.roster.edit.saved")}</p>
        </div>
      )}
      {error && (
        <div className="notice notice-crit" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{t(`coord.roster.${mode}.title`)}</caption>
          <thead>
            <tr>
              <th scope="col">{t("coord.col.outlet")}</th>
              <th scope="col">{t("coord.col.turn")}</th>
              <th scope="col" className="col-num">{t("coord.col.water")}</th>
              <th scope="col">{t("coord.col.needMet")}</th>
              <th scope="col">{t("coord.col.change")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.turns.map((x) => {
              const editing = editingId === x.id;
              const changed = changedTurns.has(`${plan.id}:${x.id}`);
              return (
                <tr key={x.id}>
                  <th scope="row">
                    {f.outlet(x.outletName)}
                    <span className="sub">{x.farmerName}</span>
                  </th>
                  <td>
                    {editing ? (
                      <div className="turn-edit">
                        <label className="turn-edit-field">
                          <span>{t("coord.roster.edit.start")}</span>
                          <input
                            type="datetime-local"
                            value={draft.start}
                            onChange={(event) => setDraft((d) => ({ ...d, start: event.target.value }))}
                          />
                        </label>
                        <label className="turn-edit-field">
                          <span>{t("coord.roster.edit.end")}</span>
                          <input
                            type="datetime-local"
                            value={draft.end}
                            onChange={(event) => setDraft((d) => ({ ...d, end: event.target.value }))}
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        {f.range(x.start, x.end)}
                        <span className="sub">{f.turnLength(x.start, x.end)}</span>
                      </>
                    )}
                  </td>
                  <td className="num">{f.m3(x.plannedVolumeM3)}</td>
                  <td className="num">
                    <span className="meter" role="img" aria-label={t("coord.roster.needMetLabel", { pct: f.pct(x.needMetPct) })}>
                      <span className="meter-fill" style={{ width: `${String(Math.min(100, x.needMetPct))}%` }} />
                    </span>
                    {f.pct(x.needMetPct)}
                  </td>
                  <td>
                    {editing ? (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busyId === x.id}
                          onClick={() => void save(x)}
                        >
                          {busyId === x.id ? t("coord.roster.edit.saving") : t("coord.roster.edit.save")}
                        </button>
                        <button type="button" className="btn" disabled={busyId === x.id} onClick={cancelEdit}>
                          {t("coord.roster.edit.cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn"
                          aria-label={t("coord.roster.edit.forTurn", { outlet: f.outlet(x.outletName) })}
                          onClick={() => beginEdit(x)}
                          disabled={anyApproved}
                        >
                          {t("coord.roster.edit.action")}
                        </button>
                        {changed && <span className="pill pill-warn">{t("coord.roster.edit.changed")}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
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

export default function RosterCompare({ water, hours, changedTurns, onApproved, onTurnSaved, onReload }: Props) {
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
        <Option
          plan={water}
          mode="equal_water"
          gini={giniWater}
          recommended={giniWater < giniHours}
          anyApproved={anyApproved}
          changedTurns={changedTurns}
          f={f}
          onApprove={approve}
          onTurnSaved={onTurnSaved}
        />
        <Option
          plan={hours}
          mode="equal_hours"
          gini={giniHours}
          recommended={false}
          anyApproved={anyApproved}
          changedTurns={changedTurns}
          f={f}
          onApprove={approve}
          onTurnSaved={onTurnSaved}
        />
      </div>
      <UnitHint />
    </section>
  );
}
