import { useState } from "react";
import { api } from "./api";
import { fmtDur, fmtFlow, fmtM3, fmtPct, fmtTime } from "./format";
import type { Lang } from "./i18n";
import { strings } from "./i18n";
import type { RosterProposal, TurnRow } from "./mock";

interface Props {
  lang: Lang;
  water: RosterProposal | null;
  hours: RosterProposal | null;
  activeId: string | null;
  onProposed: (p: RosterProposal) => void;
  onApproved: (id: string, contacts: number) => void;
}

function TurnTable({ turns, caption }: { turns: TurnRow[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Outlet</th><th scope="col">Volume</th><th scope="col">Duration</th><th scope="col">Need met</th></tr>
        </thead>
        <tbody>
          {turns.map((x) => (
            <tr key={x.id}>
              <th scope="row">{x.outletId}<span className="sub">{x.farmerName} · {fmtTime(x.start)}</span></th>
              <td>{fmtM3(x.plannedVolumeM3)}<span className="sub">{fmtFlow(x.expectedFlowM3s)}</span></td>
              <td>{fmtDur(x.durationH)}</td>
              <td>
                <span className="meter" role="img" aria-label={`${fmtPct(x.needMetPct)} need met`}>
                  <span className="meter-fill" style={{ width: `${String(Math.min(100, x.needMetPct))}%` }} />
                </span>
                {fmtPct(x.needMetPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RosterCompare({ lang, water, hours, activeId, onProposed, onApproved }: Props) {
  const t = strings[lang];
  const [busy, setBusy] = useState<"water" | "hours" | "approve" | null>(null);
  const [approvedMsg, setApprovedMsg] = useState<string | null>(null);

  async function propose(mode: "equal_water" | "equal_hours"): Promise<void> {
    setBusy(mode === "equal_water" ? "water" : "hours");
    try {
      const { proposal } = await api.proposeRoster(mode);
      onProposed(proposal);
    } finally {
      setBusy(null);
    }
  }

  async function approve(): Promise<void> {
    const id = water?.id ?? hours?.id;
    if (!id) return;
    setBusy("approve");
    try {
      const res = await api.approveRoster(id);
      onApproved(id, res.contactsQueued);
      setApprovedMsg(`${t.rosterApproved} (${String(res.contactsQueued)})`);
    } finally {
      setBusy(null);
    }
  }

  const giniW = water?.equalWaterGini ?? hours?.equalWaterGini;
  const giniH = water?.equalHoursGini ?? hours?.equalHoursGini;

  return (
    <section aria-labelledby="roster-h">
      <h3 id="roster-h">{t.rosterTitle}</h3>
      <p className="muted">{t.rosterSub}</p>
      <p className="muted small">{t.rosterWindow}: rw1 · 2026-09-15 06:00 IST → 2026-09-16 06:00 IST</p>
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy === "water"} onClick={() => void propose("equal_water")}>
          {busy === "water" ? t.loading : t.rosterProposeWater}
        </button>
        <button type="button" className="btn" disabled={busy === "hours"} onClick={() => void propose("equal_hours")}>
          {busy === "hours" ? t.loading : t.rosterProposeHours}
        </button>
      </div>
      {(giniW !== undefined || giniH !== undefined) && (
        <p role="status">
          {t.rosterGiniWater}: <strong>{giniW !== undefined ? giniW.toFixed(2) : "—"}</strong>
          {" · "}
          {t.rosterGiniHours}: <strong>{giniH !== undefined ? giniH.toFixed(2) : "—"}</strong>
        </p>
      )}
      <div className="compare">
        <div>
          <h4>{t.rosterColWater}</h4>
          {water ? <TurnTable turns={water.turns} caption={t.rosterColWater} /> : <p className="muted">—</p>}
        </div>
        <div>
          <h4>{t.rosterColHours}</h4>
          {hours ? <TurnTable turns={hours.turns} caption={t.rosterColHours} /> : <p className="muted">—</p>}
        </div>
      </div>
      <p className="muted small">{t.rosterHoursNote}</p>
      <button type="button" className="btn primary" disabled={busy === "approve" || (!water && !hours)} onClick={() => void approve()}>
        {busy === "approve" ? t.loading : t.rosterApprove}
      </button>
      {approvedMsg && <p role="status" className="ok-text">{approvedMsg} ✓ {activeId ? `(${activeId})` : ""}</p>}
    </section>
  );
}
