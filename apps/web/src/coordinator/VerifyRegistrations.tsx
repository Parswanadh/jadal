import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import { api } from "./api";
import type { FarmerRegistration } from "./types";

interface Props {
  rows: FarmerRegistration[];
  onVerified: (id: string) => void;
}

export default function VerifyRegistrations({ rows, onVerified }: Props) {
  const { t } = useI18n();
  const f = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [justChecked, setJustChecked] = useState<string | null>(null);
  const pending = rows.filter((r) => !r.verified);
  const checked = rows.filter((r) => r.verified);

  async function verify(r: FarmerRegistration): Promise<void> {
    setBusy(r.farmer.id);
    try {
      await api.verifyFarmer(r.farmer.id);
      onVerified(r.farmer.id);
      setJustChecked(r.farmer.name);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="verify-h">
      <h2 className="card-title" id="verify-h">{t("coord.farmers.title")}</h2>
      <p className="card-sub">{t("coord.farmers.sub")}</p>

      {justChecked && (
        <div className="notice notice-ok" role="status">
          <p>{t("coord.farmers.checked", { name: justChecked })}</p>
        </div>
      )}

      <h3 className="section-title">{t("coord.farmers.waiting")}</h3>
      {pending.length === 0 ? (
        <EmptyState
          title={t("coord.farmers.emptyTitle")}
          body={t("coord.farmers.emptyBody")}
          action={
            <Link className="btn" to="/farmer?tab=register">
              {t("coord.farmers.emptyAction")}
            </Link>
          }
        />
      ) : (
        <ul className="req-grid">
          {pending.map((r) => (
            <li key={r.farmer.id} className="card req-card">
              <div className="row-between">
                <strong>{r.farmer.name}</strong>
                <span className="pill pill-warn">{t("coord.farmers.pillWaiting")}</span>
              </div>
              <dl className="facts">
                <div>
                  <dt>{t("coord.farmers.phone")}</dt>
                  <dd>
                    <a href={`tel:${r.farmer.phone}`}>{r.farmer.phone}</a>
                  </dd>
                </div>
                {r.plots.map((p) => (
                  <div key={p.id}>
                    <dt>{f.outlet(p.outletName)}</dt>
                    <dd>{t("coord.farmers.plotLine", { area: f.num(p.areaHa, 1), soil: f.soil(p.soil) })}</dd>
                  </div>
                ))}
                {r.cropPlans.map((c) => (
                  <div key={c.id}>
                    <dt>{f.crop(c.crop)}</dt>
                    <dd>{t("coord.farmers.sown", { date: f.dateOnly(c.sowingDate) })}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">{r.farmer.hasSmartphone ? t("coord.farmers.smartphone") : t("coord.farmers.noSmartphone")}</p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === r.farmer.id}
                  onClick={() => void verify(r)}
                  aria-label={t("coord.farmers.verifyFor", { name: r.farmer.name })}
                >
                  {busy === r.farmer.id ? t("common.working") : t("coord.farmers.verify")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {checked.length > 0 && (
        <>
          <h3 className="section-title">{t("coord.farmers.doneTitle")}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("coord.col.farmer")}</th>
                  <th scope="col">{t("coord.col.land")}</th>
                  <th scope="col">{t("coord.col.crop")}</th>
                  <th scope="col">{t("coord.farmers.phone")}</th>
                </tr>
              </thead>
              <tbody>
                {checked.map((r) => (
                  <tr key={r.farmer.id}>
                    <th scope="row">{r.farmer.name}</th>
                    <td>
                      {r.plots.map((p) => (
                        <span className="line" key={p.id}>
                          {t("coord.farmers.landLine", { area: f.num(p.areaHa, 1), outlet: f.outlet(p.outletName) })}
                        </span>
                      ))}
                    </td>
                    <td>{f.list(r.cropPlans.map((c) => f.crop(c.crop)))}</td>
                    <td>
                      <a href={`tel:${r.farmer.phone}`}>{r.farmer.phone}</a>
                      <span className="sub">{r.farmer.hasSmartphone ? t("coord.farmers.smartphone") : t("coord.farmers.noSmartphone")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
