import { useState } from "react";
import type { FormEvent } from "react";
import { CropName, SoilType } from "@jadal/contracts";
import type { Outlet } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import type { FarmerApi, RegisterInput } from "./farmerApi";
import { validateRegistration } from "./validate";
import type { CropRowInput } from "./validate";

const LANG_OPTIONS = ["te", "en"] as const;
type PrefLang = (typeof LANG_OPTIONS)[number];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RegistrationForm({ api, outlets }: { api: FarmerApi; outlets: Outlet[] }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [prefLang, setPrefLang] = useState<PrefLang>("te");
  const [outletId, setOutletId] = useState("");
  const [plotArea, setPlotArea] = useState("");
  const [soil, setSoil] = useState<string>("");
  const [crops, setCrops] = useState<CropRowInput[]>([{ crop: "", sowing_date: "", area_share_pct: 100 }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);

  const shareTotal = crops.reduce((s, r) => s + (Number.isFinite(r.area_share_pct) ? r.area_share_pct : 0), 0);

  function updateRow(index: number, patch: Partial<CropRowInput>) {
    setCrops((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const input = {
      name,
      phone,
      outlet_id: outletId,
      plot_area_ha: Number(plotArea),
      crops,
    };
    const errs = validateRegistration(input, todayIso());
    if (soil.length === 0) errs.push("register.errSoil");
    setErrors(errs);
    setDone(false);
    if (errs.length > 0) return;
    setSending(true);
    try {
      // Single plot per registration; several crops share it via area
      // fractions (percent converted to a 0-1 fraction for the contract).
      const body: RegisterInput = {
        farmer: {
          name: name.trim(),
          phone: phone.trim(),
          language: prefLang,
          preferred_channels: ["voice"],
          has_smartphone: false,
        },
        plots: [{ outlet_id: outletId, area_ha: Number(plotArea), soil: soil as RegisterInput["plots"][number]["soil"], lat: 0, lon: 0 }], // ASSUMED: portal has no GPS capture yet; coordinator records coordinates at verification.
        crop_plans: crops.map((row) => ({
          crop: row.crop as RegisterInput["crop_plans"][number]["crop"],
          sowing_date: row.sowing_date,
          area_fraction: row.area_share_pct / 100,
          application_efficiency: 0.65, // ASSUMED portal default (furrow); coordinator corrects at verification.
          plot_index: 0,
        })),
      };
      await api.register(body);
      setDone(true);
    } catch {
      setErrors(["app.error"]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="fp-card" aria-labelledby="fp-reg-title">
      <h2 id="fp-reg-title">{t("register.title")}</h2>
      <p>{t("register.intro")}</p>
      {done && (
        <div className="fp-success" role="status">
          <strong>{t("register.success")}</strong>
          <br />
          {t("register.successDetail")}
        </div>
      )}
      {errors.length > 0 && (
        <div className="fp-errors" role="alert">
          <ul>
            {errors.map((e) => (
              <li key={e}>{t(e)}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <div className="fp-field">
          <label htmlFor="fp-reg-name">{t("register.name")}</label>
          <input id="fp-reg-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-reg-phone">{t("register.phone")}</label>
          <input id="fp-reg-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-reg-lang">{t("register.prefLang")}</label>
          <select id="fp-reg-lang" value={prefLang} onChange={(e) => setPrefLang(e.target.value as PrefLang)}>
            {LANG_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l === "te" ? "తెలుగు" : "English"}
              </option>
            ))}
          </select>
        </div>
        <div className="fp-field">
          <label htmlFor="fp-reg-outlet">{t("register.outlet")}</label>
          <select id="fp-reg-outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">—</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="fp-field">
          <label htmlFor="fp-reg-area">{t("register.plotArea")}</label>
          <input id="fp-reg-area" value={plotArea} onChange={(e) => setPlotArea(e.target.value)} inputMode="decimal" type="number" min="0" step="0.1" />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-reg-soil">{t("register.soil")}</label>
          <select id="fp-reg-soil" value={soil} onChange={(e) => setSoil(e.target.value)}>
            <option value="">—</option>
            {SoilType.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <h3>{t("register.cropsTitle")}</h3>
        <p>{t("register.cropsHint")}</p>
        {crops.map((row, i) => (
          <div className="fp-crop-row" key={i}>
            <div className="fp-field">
              <label htmlFor={`fp-crop-${i}`}>{t("register.crop")}</label>
              <select id={`fp-crop-${i}`} value={row.crop} onChange={(e) => updateRow(i, { crop: e.target.value })}>
                <option value="">—</option>
                {CropName.options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="fp-row">
              <div className="fp-field">
                <label htmlFor={`fp-sow-${i}`}>{t("register.sowingDate")}</label>
                <input id={`fp-sow-${i}`} type="date" value={row.sowing_date} onChange={(e) => updateRow(i, { sowing_date: e.target.value })} />
              </div>
              <div className="fp-field">
                <label htmlFor={`fp-share-${i}`}>{t("register.areaShare")}</label>
                <input
                  id={`fp-share-${i}`}
                  type="number"
                  min="1"
                  max="100"
                  value={Number.isFinite(row.area_share_pct) ? row.area_share_pct : ""}
                  onChange={(e) => updateRow(i, { area_share_pct: Number(e.target.value) })}
                />
              </div>
            </div>
            {crops.length > 1 && (
              <button type="button" className="fp-btn fp-btn-secondary" onClick={() => setCrops((prev) => prev.filter((_, j) => j !== i))}>
                {t("register.removeCrop")}
              </button>
            )}
          </div>
        ))}
        <p>
          {t("register.shareTotal")}: {shareTotal}%
        </p>
        <div className="fp-field">
          <button
            type="button"
            className="fp-btn fp-btn-secondary"
            onClick={() => setCrops((prev) => [...prev, { crop: "", sowing_date: "", area_share_pct: 0 }])}
          >
            {t("register.addCrop")}
          </button>
        </div>
        <button className="fp-btn" type="submit" disabled={sending}>
          {t("register.submit")}
        </button>
      </form>
    </section>
  );
}
