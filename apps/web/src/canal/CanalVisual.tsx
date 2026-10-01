import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import PageHeader from "../components/PageHeader";
import UnitHint from "../components/UnitHint";
import { getNeedMet, getOverrunCase, loadCanalVisual, outletById } from "./api";
import type { DataSource } from "./api";
import type { CanalVisualData, RosterMode } from "./types";
import "./canal.css";

/* Display-only geometry. These map a SUPPLIED flow (m3/s from data) to pixels;
   they never create water numbers. */
const SVG_W = 800;
const SVG_H = 190;
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

/** The fixture names the canal "Kondaveedu Minor (demo)". The demo badge already says so. */
function plainCanalName(name: string): string {
  return name.replace(/\s*\(demo\)\s*$/i, "");
}

export interface CanalVisualProps {
  /** Pre-loaded bundle (tests/storybook); when omitted the component loads it from the shared API client. */
  initial?: CanalVisualData;
}

export default function CanalVisual({ initial }: CanalVisualProps) {
  const { t } = useI18n();
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

  if (failed) return <p className="notice notice-crit" role="alert">{t("common.loadError")}</p>;
  if (!loaded) return <p className="muted" role="status">{t("common.loading")}</p>;
  return <CanalVisualView data={loaded.data} />;
}

function CanalVisualView({ data }: { data: CanalVisualData }) {
  const { t } = useI18n();
  const f = useFormat();
  const [mode, setMode] = useState<RosterMode>("equal_hours");
  const [overrunOutlet, setOverrunOutlet] = useState<string>(data.outlets[0]?.id ?? "o1");
  const [stepIdx, setStepIdx] = useState(0);

  const steps = data.overrunSteps;
  const hours = steps[stepIdx] ?? 0;
  const needRows = getNeedMet(data, mode);
  const overrunCase = getOverrunCase(data, overrunOutlet, hours);
  const overrunIsTail = hours > 0 && overrunCase === undefined;
  const outletLabel = (id: string): string => {
    const o = outletById(data, id);
    return o ? f.outlet(o.name) : id;
  };

  // Ribbon polygon: head (uses canal.head_discharge_m3s) then each outlet's
  // supplied flow. Ends flat at the last outlet, with no invented taper.
  const rail = [{ x: xForChainage(0, data.canal.length_m), h: halfH(data.canal.head_discharge_m3s) }].concat(
    data.flows.map((fl) => ({ x: xForChainage(fl.chainage_m, data.canal.length_m), h: halfH(fl.flow_m3s) })),
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
        eyebrow={`${t("page.canal.eyebrow")} · ${plainCanalName(data.canal.name)}`}
        title={t("page.canal.title")}
        lead={t("page.canal.lead")}
        titleId="canal-title"
      />

      <figure className="canal-figure">
        <div className="canal-svg-wrap">
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} role="img" aria-label={t("canal.mapLabel")}>
            <title>{t("canal.mapLabel")}</title>
            <polygon points={`${top} ${bottom}`} className="canal-water" />
            {[0.25, 0.5, 0.75].map((frac) => {
              const x = PAD_X + frac * (SVG_W - PAD_X * 2);
              return (
                <text key={frac} x={x} y={CENTER_Y + 4} className="canal-flow-arrow" aria-hidden="true">
                  ›
                </text>
              );
            })}
            <text x={PAD_X} y={CENTER_Y - halfH(data.canal.head_discharge_m3s) - 10} className="canal-end-label">
              {t("canal.head")}
            </text>
            <text
              x={SVG_W - PAD_X}
              y={CENTER_Y - halfH(data.flows[data.flows.length - 1]?.flow_m3s ?? 0) - 10}
              textAnchor="end"
              className="canal-end-label"
            >
              {t("canal.tail")}
            </text>
            {data.flows.map((fl) => {
              const x = xForChainage(fl.chainage_m, data.canal.length_m);
              const cls = [
                "canal-outlet",
                fl.outlet_id === overrunOutlet ? "is-selected" : "",
                downstreamIds.has(fl.outlet_id) ? "is-downstream" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <g key={fl.outlet_id} className={cls}>
                  <line x1={x} y1={CENTER_Y - halfH(fl.flow_m3s)} x2={x} y2={CENTER_Y + halfH(fl.flow_m3s) + 34} />
                  <circle cx={x} cy={CENTER_Y + halfH(fl.flow_m3s) + 34} r="9" />
                  <text x={x} y={CENTER_Y + halfH(fl.flow_m3s) + 38} textAnchor="middle" className="canal-outlet-n">
                    {fl.outlet_id.replace("o", "")}
                  </text>
                  <text x={x} y={CENTER_Y + halfH(fl.flow_m3s) + 66} textAnchor="middle" className="canal-chainage">
                    {t("canal.km", { km: (fl.chainage_m / 1000).toFixed(1) })}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <figcaption className="muted small">{t("canal.mapCaption")}</figcaption>
      </figure>

      <div className="grid grid-main-side canal-grid">
        <section className="card" aria-labelledby="canal-share">
          <h2 className="card-title" id="canal-share">{t("canal.shareTitle")}</h2>
          <p className="card-sub">{t("canal.shareSub")}</p>
          <div className="canal-mode" role="radiogroup" aria-label={t("canal.modeLabel")}>
            <div className="canal-mode-btns">
              <button type="button" role="radio" aria-checked={mode === "equal_hours"} onClick={() => setMode("equal_hours")}>
                {t("canal.equalHours")}
                <small>{t("canal.equalHoursHint")}</small>
              </button>
              <button type="button" role="radio" aria-checked={mode === "equal_water"} onClick={() => setMode("equal_water")}>
                {t("canal.equalWater")}
                <small>{t("canal.equalWaterHint")}</small>
              </button>
            </div>
          </div>

          <ol className="canal-bars" aria-label={t("canal.needMetList")}>
            {needRows.map((r) => (
              <li key={r.outlet_id} aria-label={t("canal.rowLabel", { name: r.farmer_name, outlet: outletLabel(r.outlet_id), pct: r.pct })}>
                <span className="canal-farmer">
                  <strong>{r.farmer_name}</strong>
                  <span className="canal-outlet-tag">{outletLabel(r.outlet_id)}</span>
                </span>
                <span className="canal-track" aria-hidden="true">
                  <span className="canal-fill" data-band={r.pct < 60 ? "low" : r.pct < 90 ? "mid" : "high"} style={{ width: `${r.pct}%` }} />
                </span>
                <span className="canal-pct" aria-live="polite">
                  {t("canal.pctMet", { pct: r.pct })}
                </span>
              </li>
            ))}
          </ol>
          <p className="canal-note">
            {t("canal.fairnessNote", {
              hours: f.num(data.comparison.equal_hours_gini, 2),
              water: f.num(data.comparison.equal_water_gini, 2),
            })}
          </p>
        </section>

        <section className="card canal-overrun" aria-labelledby="canal-overrun">
          <h2 className="card-title" id="canal-overrun">{t("canal.overrunTitle")}</h2>
          <p className="card-sub">{t("canal.overrunSub")}</p>
          <div className="canal-overrun-ctl">
            <label>
              <span>{t("canal.overrunOutlet")}</span>
              <select value={overrunOutlet} onChange={(e) => setOverrunOutlet(e.target.value)}>
                {data.outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t("canal.outletOption", { outlet: f.outlet(o.name), km: (o.chainage_m / 1000).toFixed(1) })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("canal.overrunHours", { h: hours })}</span>
              <input
                type="range"
                min={0}
                max={steps.length - 1}
                step={1}
                value={stepIdx}
                onChange={(e) => setStepIdx(Number(e.target.value))}
                aria-valuetext={t("canal.hoursValue", { h: hours })}
              />
              <span className="canal-steps" aria-hidden="true">
                {steps.map((s) => (
                  <span key={s}>{t("canal.hoursValue", { h: s })}</span>
                ))}
              </span>
            </label>
          </div>
          <div aria-live="polite">
            {hours === 0 && <p className="canal-note">{t("canal.overrunNone")}</p>}
            {overrunIsTail && <p className="canal-note">{t("canal.overrunTailNote")}</p>}
            {overrunCase && (
              <div className="table-wrap">
                <table className="table">
                  <caption>{t("canal.overrunDownstream")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("canal.colOutlet")}</th>
                      <th scope="col" className="col-num">{t("canal.colLost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrunCase.losses.map(([id, lost]) => (
                      <tr key={id}>
                        <td>{outletLabel(id)}</td>
                        <td className="num">{f.m3(lost)}</td>
                      </tr>
                    ))}
                    <tr className="canal-total">
                      <th scope="row">{t("canal.overrunTotal")}</th>
                      <td className="num">{f.m3(overrunCase.total_lost_m3)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <UnitHint />
        </section>
      </div>

      <details className="disclosure canal-flows">
        <summary>{t("canal.flowsSummary")}</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("canal.colOutlet")}</th>
                <th scope="col" className="col-num">{t("canal.colDistance")}</th>
                <th scope="col" className="col-num">{t("canal.colFlow")}</th>
              </tr>
            </thead>
            <tbody>
              {data.flows.map((fl) => (
                <tr key={fl.outlet_id}>
                  <th scope="row">{outletLabel(fl.outlet_id)}</th>
                  <td className="num">{t("canal.km", { km: (fl.chainage_m / 1000).toFixed(1) })}</td>
                  <td className="num">{fl.flow_m3s} {t("units.m3s")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t("canal.flowsHelp")}</p>
      </details>
    </section>
  );
}
