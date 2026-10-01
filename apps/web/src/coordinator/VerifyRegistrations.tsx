import { useState } from "react";
import { api } from "./api";
import type { Lang } from "./i18n";
import { strings } from "./i18n";
import type { FarmerRegistration } from "./mock";

interface Props {
  lang: Lang;
  rows: FarmerRegistration[];
  onVerified: (id: string) => void;
}

export default function VerifyRegistrations({ lang, rows, onVerified }: Props) {
  const t = strings[lang];
  const [busy, setBusy] = useState<string | null>(null);
  const pending = rows.filter((r) => !r.verified);

  async function verify(id: string): Promise<void> {
    setBusy(id);
    try {
      await api.verifyFarmer(id);
      onVerified(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="verify-h">
      <h3 id="verify-h">{t.verifyTitle}</h3>
      <p className="muted">{t.verifySub}</p>
      {pending.length === 0 ? (
        <p role="status">{t.verifyEmpty}</p>
      ) : (
        <ul className="cards">
          {rows.map((r) => (
            <li key={r.farmer.id} className="card">
              <div className="card-head">
                <strong>{r.farmer.name}</strong>
                <span className={`pill ${r.verified ? "ok" : "warn"}`} role="status">
                  {r.verified ? t.verifyVerified : t.verifyPending}
                </span>
              </div>
              <dl className="kv">
                <div><dt>{t.phone}</dt><dd><a href={`tel:${r.farmer.phone}`}>{r.farmer.phone}</a></dd></div>
                {r.plots.map((p) => (
                  <div key={p.id}>
                    <dt>{t.outlet} {p.outletId}</dt>
                    <dd>{p.areaHa} {t.areaHa} · {t.soil}: {p.soil}</dd>
                  </div>
                ))}
                {r.cropPlans.map((c) => (
                  <div key={c.id}>
                    <dt>{t.crop}</dt>
                    <dd>{c.crop} · {t.sowing}: {c.sowingDate}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">{r.farmer.hasSmartphone ? t.hasSmartphone : t.noSmartphone}</p>
              {!r.verified && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy === r.farmer.id}
                  onClick={() => void verify(r.farmer.id)}
                  aria-label={`${t.verifyAction}: ${r.farmer.name}`}
                >
                  {busy === r.farmer.id ? t.loading : t.verifyAction}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{pending.length} pending</p>
    </section>
  );
}
