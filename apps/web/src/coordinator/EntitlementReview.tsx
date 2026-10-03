import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import ConfirmAction from "../components/ConfirmAction";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import { api } from "./api";
import type { EntitlementRow } from "./types";

interface Props {
  rows: EntitlementRow[];
  seasonTotalM3: number;
  explanation: string;
  onApproved: (rows: EntitlementRow[]) => void;
  onGoFarmers: () => void;
  onReload: () => void;
}

const STATUS_PILL = { proposed: "pill-warn", approved: "pill-ok", edited: "pill-ok" } as const;

export default function EntitlementReview({ rows, seasonTotalM3, explanation, onApproved, onGoFarmers, onReload }: Props) {
  const { t, lang } = useI18n();
  const f = useFormat();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [done, setDone] = useState<number | null>(null);

  function volumeOf(r: EntitlementRow): number {
    return draft[r.id] ?? r.volumeM3;
  }

  function setEdit(id: string, v: string): void {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    setDraft((d) => ({ ...d, [id]: Math.round(n) }));
    setDone(null);
  }

  async function approve(): Promise<void> {
    const edits = rows
      .filter((r) => draft[r.id] !== undefined && draft[r.id] !== r.volumeM3)
      .map((r) => ({ id: r.id, volume_m3: draft[r.id] ?? r.volumeM3 }));
    const approved = await api.approveEntitlements(edits);
    const next = rows.map((r) => ({
      ...r,
      volumeM3: draft[r.id] ?? r.volumeM3,
      status: (draft[r.id] !== undefined && draft[r.id] !== r.volumeM3 ? "edited" : "approved") as EntitlementRow["status"],
    }));
    onApproved(next);
    setDraft({});
    setDone(approved > 0 ? approved : rows.length);
  }

  const weekStart = rows[0]?.weekStart;
  const needsApproval = rows.some((r) => r.status === "proposed") || Object.keys(draft).length > 0;

  return (
    <section aria-labelledby="ent-h">
      <h2 className="card-title" id="ent-h">{t("coord.ent.title")}</h2>
      <p className="card-sub">{t("coord.ent.sub")}</p>

      {rows.length === 0 ? (
        <EmptyState
          title={t("coord.ent.emptyTitle")}
          body={t("coord.ent.emptyBody")}
          action={
            <div className="btn-row center">
              <button type="button" className="btn btn-primary" onClick={onGoFarmers}>
                {t("coord.ent.emptyAction")}
              </button>
              <button type="button" className="btn" onClick={onReload}>
                {t("coord.ent.refresh")}
              </button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-main-side">
          <div className="stack">
            <div className="table-wrap">
              <table className="table">
                <caption>{weekStart ? t("coord.ent.week", { day: f.day(`${weekStart}T12:00:00+05:30`) }) : t("coord.ent.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("coord.col.farmer")}</th>
                    <th scope="col">{t("coord.col.crop")}</th>
                    <th scope="col" className="col-num">{t("coord.col.share")}</th>
                    <th scope="col" className="col-num">{t("coord.col.need")}</th>
                    <th scope="col">{t("coord.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.farmerName}</th>
                      <td>{f.crop(r.crop)}</td>
                      <td className="num">
                        <label className="sr-only" htmlFor={`ent-${r.id}`}>
                          {t("coord.ent.editLabel", { name: r.farmerName })}
                        </label>
                        <input id={`ent-${r.id}`} type="number" min={0} step={5} value={volumeOf(r)} onChange={(e) => setEdit(r.id, e.target.value)} />
                      </td>
                      <td className="num">{f.num(r.netMm, 1)} {t("units.mm")}</td>
                      <td>
                        <span className={`pill ${STATUS_PILL[r.status]}`}>{t(`coord.ent.status.${r.status}`)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row">
              <ConfirmAction
                variant="primary"
                label={t("coord.ent.approve")}
                question={t("coord.ent.approveQuestion", { n: rows.length })}
                confirmLabel={t("coord.ent.approveYes")}
                onConfirm={approve}
                disabled={!needsApproval}
              />
            </div>
            {done !== null && (
              <div className="notice notice-ok" role="status">
                <p>{t("coord.ent.done", { n: done })}</p>
              </div>
            )}
            {!needsApproval && done === null && <p className="muted">{t("coord.ent.allApproved")}</p>}
          </div>

          <aside className="card">
            <h3 className="card-title">{t("coord.ent.asideTitle")}</h3>
            <p>{t("coord.ent.how")}</p>
            <p className="muted small">{t("coord.ent.mmHelp")}</p>
            <p className="req-ask">{t("coord.ent.total", { m3: f.m3(seasonTotalM3) })}</p>
            <UnitHint />
            {lang === "en" && explanation && (
              <details className="disclosure">
                <summary>{t("coord.ent.moreDetails")}</summary>
                <p>{explanation}</p>
              </details>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
