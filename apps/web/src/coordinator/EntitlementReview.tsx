import { useState } from "react";
import { api } from "./api";
import { fmtM3 } from "./format";
import type { Lang } from "./i18n";
import { strings } from "./i18n";
import type { EntitlementRow } from "./types";

interface Props {
  lang: Lang;
  rows: EntitlementRow[];
  seasonTotalM3: number;
  explanationEn: string;
  explanationTe: string;
  onApproved: (rows: EntitlementRow[]) => void;
}

export default function EntitlementReview({ lang, rows, seasonTotalM3, explanationEn, explanationTe, onApproved }: Props) {
  const t = strings[lang];
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  function editedVolume(r: EntitlementRow): number {
    return draft[r.id] ?? r.volumeM3;
  }

  function setEdit(id: string, v: string): void {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    setDraft((d) => ({ ...d, [id]: Math.round(n) }));
    setDone(null);
  }

  async function approve(): Promise<void> {
    setBusy(true);
    try {
      const edits = rows
        .filter((r) => draft[r.id] !== undefined && draft[r.id] !== r.volumeM3)
        .map((r) => ({ id: r.id, volume_m3: draft[r.id] ?? r.volumeM3 }));
      const res = await api.approveEntitlements(edits);
      const next = rows.map((r) => ({
        ...r,
        volumeM3: draft[r.id] ?? r.volumeM3,
        status: (draft[r.id] !== undefined && draft[r.id] !== r.volumeM3 ? "edited" : "approved") as EntitlementRow["status"],
      }));
      onApproved(next);
      setDone(res.approved > 0 ? res.approved : rows.length);
    } finally {
      setBusy(false);
    }
  }

  const explanation = lang === "te" && explanationTe ? explanationTe : explanationEn;

  return (
    <section aria-labelledby="ent-h">
      <h3 id="ent-h">{t.entTitle}</h3>
      <p className="muted">{t.entSub}</p>
      <details className="explain">
        <summary>{t.entExplanation}</summary>
        <p>{explanation}</p>
      </details>
      <p><strong>{t.entSeasonTotal}:</strong> {fmtM3(seasonTotalM3)}</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{t.entTitle}</caption>
          <thead>
            <tr>
              <th scope="col">Farmer</th>
              <th scope="col">{t.crop}</th>
              <th scope="col">{t.entVolume}</th>
              <th scope="col">{t.entNetMm}</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.farmerName}<span className="sub">{r.farmerId} · {r.cropPlanId}</span></th>
                <td className="text">{r.crop}</td>
                <td>
                  <label className="sr-only" htmlFor={`ent-${r.id}`}>{t.entEdit} {r.farmerName}</label>
                  <input
                    id={`ent-${r.id}`}
                    className="num"
                    type="number"
                    min={0}
                    step={5}
                    value={editedVolume(r)}
                    onChange={(e) => setEdit(r.id, e.target.value)}
                  />
                </td>
                <td>{r.netMm}</td>
                <td>
                  <span className={`pill ${r.status === "proposed" ? "warn" : "ok"}`}>
                    {r.status === "proposed" ? t.entUnapproved : r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void approve()}>
        {busy ? t.loading : t.entApprove}
      </button>
      {done !== null && <p role="status" className="ok-text">{done} {t.entApproveCount} ✓</p>}
    </section>
  );
}
