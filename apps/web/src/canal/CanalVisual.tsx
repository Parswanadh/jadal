import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import { getNeedMet, getOverrunCase, loadCanalVisual, outletById } from "./api";
import type { DataSource } from "./api";
import { STR } from "./strings";
import type { CanalVisualData, RosterMode } from "./types";
import "./canal.css";

/* Display-only geometry. These map a SUPPLIED flow (m3/s from data) to pixels;
   they never create water numbers. */
const SVG_W = 800;
const SVG_H = 205;
const PAD_X = 50;
const CENTER_Y = 70;
/* Ribbon half-height is proportional to the supplied flow, so it tapers from head to tail. */
const PX_PER_M3S = 200;

function xForChainage(chainage_m: number, length_m: number): number {
  return PAD_X + (chainage_m / length_m) * (SVG_W - PAD_X * 2);
}

function halfH(flow_m3s: number): number {
  return flow_m3s * PX_PER_M3S;
}

/** "English · Telugu" when a Telugu form exists, otherwise just the English name. */
function bi(en: string, te: string): string {
  return te && te !== en ? `${en} · ${te}` : en;
}

export interface CanalVisualProps {
  /** Pre-loaded bundle (tests/storybook); when omitted the component loads it from the shared API client. */
  initial?: CanalVisualData;
}

export default function CanalVisual({ initial }: CanalVisualProps) {
  const { t: tr } = useI18n();
  const [loaded, setLoaded] = useState<{ data: CanalVisualData; source: DataSource } | null>(
    initial ? { data: initial, source: "mock" } : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (initial) return;
    let live = true;
    loadCanalVisual()
      .then((b) => {
        if (live) setLoaded(b);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [initial]);

  if (failed) return <p role="alert">{tr("canal.ui.error")}</p>;
  if (!loaded) return <p role="status">{tr("canal.ui.loading")}</p>;
  return <CanalVisualView data={loaded.data} source={loaded.source} />;
}

function CanalVisualView({ data, source }: { data: CanalVisualData; source: DataSource }) {
  const { lang, t: tr } = useI18n();
  const [mode, setMode] = useState<RosterMode>("equal_hours");
  const [overrunOutlet, setOverrunOutlet] = useState<string>(data.outlets[0]?.id ?? "o1");
  const [stepIdx, setStepIdx] = useState(0);

  const t = STR[lang];
  /** Name in the active language only (falls back to English when no Telugu form exists). */
  const one = (en: string, te: string): string => (lang === "te" && te ? te : en);
  const steps = data.overrunSteps;
  const hours = steps[stepIdx] ?? 0;
  const needRows = getNeedMet(data, mode);
  const overrunCase = getOverrunCase(data, overrunOutlet, hours);
  const overrunIsTail = hours > 0 && overrunCase === undefined;

  // Ribbon polygon: head (uses canal.head_discharge_m3s) then each outlet's
  // supplied flow. Ends flat at the last outlet — no invented taper.
  const rail = [{ x: xForChainage(0, data.canal.length_m), h: halfH(data.canal.head_discharge_m3s) }].concat(
    data.flows.map((f) => ({ x: xForChainage(f.chainage_m, data.canal.length_m), h: halfH(f.flow_m3s) })),
  );
  const top = rail.map((p) => `${p.x.toFixed(1)},${(CENTER_Y - p.h).toFixed(1)}`).join(" ");
  const bottom = rail
    .slice()
    .reverse()
    .map((p) => `${p.x.toFixed(1)},${(CENTER_Y + p.h).toFixed(1)}`)
    .join(" ");

  const downstreamIds = new Set((overrunCase?.losses ?? []).map(([id]) => id));

  return (
    <section className="canal-hero" aria-labelledby="canal-title">
      <PageHeader
        eyebrow={`${tr("page.canal.eyebrow")} · ${bi(data.canal.name, data.canal.name_te)}`}
        title={tr("page.canal.title")}
        lead={tr("page.canal.lead")}
        titleId="canal-title"
      />

      <div className="canal-svg-wrap">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          role="img"
          aria-label={`${t.title}: ${t.head} ${data.canal.head_discharge_m3s} m³/s → ${t.tail}`}
        >
          <title>{t.title}</title>
          <desc>
            {t.subtitle} {t.head}: {data.canal.head_discharge_m3s} m³/s.{" "}
            {data.flows.map((f) => `${f.outlet_id}: ${f.flow_m3s}`).join(", ")}
          </desc>
          <polygon points={`${top} ${bottom}`} className="canal-water" />
          {[0.25, 0.5, 0.75].map((f) => {
            const x = PAD_X + f * (SVG_W - PAD_X * 2);
            return (
              <text key={f} x={x} y={CENTER_Y + 4} className="canal-flow-arrow" aria-hidden="true">
                ›
              </text>
            );
          })}
          <text x={PAD_X} y={CENTER_Y - halfH(data.canal.head_discharge_m3s) - 10} className="canal-end-label">
            {t.head} · {data.canal.head_discharge_m3s} m³/s
          </text>
          <text
            x={SVG_W - PAD_X}
            y={CENTER_Y - halfH(data.flows[data.flows.length - 1]?.flow_m3s ?? 0) - 10}
            textAnchor="end"
            className="canal-end-label"
          >
            {t.tail}
          </text>
          {data.flows.map((f, idx) => {
            const x = xForChainage(f.chainage_m, data.canal.length_m);
            const cls = [
              "canal-outlet",
              f.outlet_id === overrunOutlet ? "is-selected" : "",
              downstreamIds.has(f.outlet_id) ? "is-downstream" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <g key={f.outlet_id} className={cls}>
                <line x1={x} y1={CENTER_Y - halfH(f.flow_m3s)} x2={x} y2={CENTER_Y + halfH(f.flow_m3s) + 34} />
                <circle cx={x} cy={CENTER_Y + halfH(f.flow_m3s) + 34} r="7" />
                <text x={x} y={CENTER_Y + halfH(f.flow_m3s) + 37} textAnchor="middle" className="canal-outlet-n">
                  {f.outlet_id.replace("o", "")}
                </text>
                <text x={x} y={CENTER_Y + halfH(f.flow_m3s) + (idx % 2 === 0 ? 62 : 82)} textAnchor="middle" className="canal-chainage">
                  {(f.chainage_m / 1000).toFixed(1)} {t.kmUnit} · {f.flow_m3s} m³/s
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="canal-mode" role="radiogroup" aria-label={t.modeLabel}>
        <span className="canal-mode-label">{t.modeLabel}</span>
        <div className="canal-mode-btns">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "equal_hours"}
            onClick={() => setMode("equal_hours")}
          >
            {t.equalHours}
            <small>{t.equalHoursHint}</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "equal_water"}
            onClick={() => setMode("equal_water")}
          >
            {t.equalWater}
            <small>{t.equalWaterHint}</small>
          </button>
        </div>
      </div>

      <ol className="canal-bars" aria-label={t.needMet}>
        {needRows.map((r) => (
          <li key={r.outlet_id} aria-label={`${bi(r.farmer_name, r.farmer_name_te)} — ${r.pct}${t.needMetUnit}`}>
            <span className="canal-farmer">
              <strong>
                {bi(r.farmer_name, r.farmer_name_te)}
              </strong>
              <span className="canal-outlet-tag">{r.outlet_id.toUpperCase()}</span>
            </span>
            <span className="canal-track" aria-hidden="true">
              <span
                className="canal-fill"
                data-band={r.pct < 60 ? "low" : r.pct < 90 ? "mid" : "high"}
                style={{ width: `${r.pct}%` }}
              />
            </span>
            <span className="canal-pct" aria-live="polite">
              {r.pct}% {t.needMet.replace("%", "").trim()}
            </span>
          </li>
        ))}
      </ol>
      <p className="canal-note">
        {t.fairnessNote} Gini — {t.equalHours}: {data.comparison.equal_hours_gini} · {t.equalWater}:{" "}
        {data.comparison.equal_water_gini}.
      </p>

      <div className="canal-overrun">
        <h3>{t.overrunTitle}</h3>
        <div className="canal-overrun-ctl">
          <label>
            <span>{t.overrunOutlet}</span>
            <select value={overrunOutlet} onChange={(e) => setOverrunOutlet(e.target.value)}>
              {data.outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {one(o.name, o.name_te)} — {(o.chainage_m / 1000).toFixed(1)} {t.kmUnit}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              {t.overrunHours}: {hours} h
            </span>
            <input
              type="range"
              min={0}
              max={steps.length - 1}
              step={1}
              value={stepIdx}
              onChange={(e) => setStepIdx(Number(e.target.value))}
              aria-valuetext={`${hours} h`}
            />
            <span className="canal-steps" aria-hidden="true">
              {steps.map((s) => (
                <span key={s}>{s}h</span>
              ))}
            </span>
          </label>
        </div>
        <div aria-live="polite">
          {hours === 0 && <p className="canal-note">{t.overrunNone}</p>}
          {overrunIsTail && <p className="canal-note">{t.overrunTailNote}</p>}
          {overrunCase && (
            <table className="canal-loss-table">
              <caption>{t.overrunDownstream}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.overrunOutlet}</th>
                  <th scope="col">{t.overrunDownstream} (m³)</th>
                </tr>
              </thead>
              <tbody>
                {overrunCase.losses.map(([id, lost]) => {
                  const o = outletById(data, id);
                  return (
                    <tr key={id}>
                      <td>
                        {o ? one(o.name, o.name_te) : id}
                      </td>
                      <td>{lost.toLocaleString("en-IN")}</td>
                    </tr>
                  );
                })}
                <tr className="canal-total">
                  <th scope="row">{t.overrunTotal}</th>
                  <td>{overrunCase.total_lost_m3.toLocaleString("en-IN")}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="canal-foot">
        <span className="canal-badge" data-source={source}>
          {source === "api" ? t.sourceApi : t.sourceMock}
        </span>
        <span>{t.dataNote}</span>
      </footer>
    </section>
  );
}
