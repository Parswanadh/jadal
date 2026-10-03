import { useState } from "react";
import type { FormEvent } from "react";
import { CropName, SoilType } from "@jadal/contracts";
import type { Outlet } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import type { FarmerApi, RegisterInput } from "./farmerApi";
import { validateRegistration } from "./validate";
import type { CropRowInput } from "./validate";

const LANG_OPTIONS = ["te", "en"] as const;
type PrefLang = (typeof LANG_OPTIONS)[number];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CROP: CropRowInput = { crop: "", sowing_date: "", area_share_pct: 100 };

export default function RegistrationForm({ api, outlets }: { api: FarmerApi; outlets: Outlet[] }) {
  const { t } = useI18n();
  const f = useFormat();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [prefLang, setPrefLang] = useState<PrefLang>("te");
  const [outletId, setOutletId] = useState("");
  const [plotArea, setPlotArea] = useState("");
  const [soil, setSoil] = useState<string>("");
  const [crops, setCrops] = useState<CropRowInput[]>([EMPTY_CROP]);
  const [errors, setErrors] = useState<string[]>([]);
  const [sentName, setSentName] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const shareTotal = crops.reduce((s, r) => s + (Number.isFinite(r.area_share_pct) ? r.area_share_pct : 0), 0);

  function updateRow(index: number, patch: Partial<CropRowInput>) {
    setCrops((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const input = { name, phone, outlet_id: outletId, plot_area_ha: Number(plotArea), crops };
    const errs = validateRegistration(input, todayIso());
    if (soil.length === 0) errs.push("register.errSoil");
    setErrors(errs);
    setSentName(null);
    if (errs.length > 0) return;
    setSending(true);
    try {
      // One plot per registration. Several crops share it through area
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
      setSentName(name.trim());
      setName("");
      setPhone("");
      setOutletId("");
      setPlotArea("");
      setSoil("");
      setCrops([EMPTY_CROP]);
    } catch {
      setErrors(["common.loadError"]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-main-side">
      <section className="card" aria-labelledby="reg-title">
        <h2 className="card-title" id="reg-title">{t("register.title")}</h2>
        <p className="card-sub">{t("register.intro")}</p>
        {sentName !== null && (
          <div className="notice notice-ok" role="status">
            <p>
              <strong>{t("register.success", { name: sentName })}</strong>
              <br />
              {t("register.successDetail")}
            </p>
          </div>
        )}
        {errors.length > 0 && (
          <div className="notice notice-crit" role="alert">
            <ul>
              {errors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="reg-name">{t("register.name")}</label>
              <input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="reg-phone">{t("register.phone")}</label>
              <input id="reg-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
            </div>
            <div className="field">
              <label htmlFor="reg-lang">{t("register.prefLang")}</label>
              <select id="reg-lang" value={prefLang} onChange={(e) => setPrefLang(e.target.value as PrefLang)}>
                {LANG_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l === "te" ? t("controls.langOptionTe") : t("controls.languageEnglish")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reg-outlet">{t("register.outlet")}</label>
              <select id="reg-outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                <option value="">{t("register.choose")}</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {f.outlet(o.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reg-area">{t("register.plotArea")}</label>
              <input id="reg-area" value={plotArea} onChange={(e) => setPlotArea(e.target.value)} inputMode="decimal" type="number" min="0" step="0.1" />
            </div>
            <div className="field">
              <label htmlFor="reg-soil">{t("register.soil")}</label>
              <select id="reg-soil" value={soil} onChange={(e) => setSoil(e.target.value)}>
                <option value="">{t("register.choose")}</option>
                {SoilType.options.map((s) => (
                  <option key={s} value={s}>
                    {f.soil(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="form-section">{t("register.cropsTitle")}</h3>
          <p className="muted">{t("register.cropsHint")}</p>
          {crops.map((row, i) => (
            <div className="crop-row" key={i}>
              <div className="field-grid three">
                <div className="field">
                  <label htmlFor={`reg-crop-${i}`}>{t("register.crop")}</label>
                  <select id={`reg-crop-${i}`} value={row.crop} onChange={(e) => updateRow(i, { crop: e.target.value })}>
                    <option value="">{t("register.choose")}</option>
                    {CropName.options.map((c) => (
                      <option key={c} value={c}>
                        {f.crop(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`reg-sow-${i}`}>{t("register.sowingDate")}</label>
                  <input id={`reg-sow-${i}`} type="date" value={row.sowing_date} onChange={(e) => updateRow(i, { sowing_date: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`reg-share-${i}`}>{t("register.areaShare")}</label>
                  <input
                    id={`reg-share-${i}`}
                    type="number"
                    min="1"
                    max="100"
                    value={Number.isFinite(row.area_share_pct) ? row.area_share_pct : ""}
                    onChange={(e) => updateRow(i, { area_share_pct: Number(e.target.value) })}
                  />
                </div>
              </div>
              {crops.length > 1 && (
                <button type="button" className="btn" onClick={() => setCrops((prev) => prev.filter((_, j) => j !== i))}>
                  {t("register.removeCrop")}
                </button>
              )}
            </div>
          ))}
          <p className="small">{t("register.shareTotal", { n: shareTotal })}</p>
          <div className="btn-row form-actions">
            <button type="button" className="btn" onClick={() => setCrops((prev) => [...prev, { crop: "", sowing_date: "", area_share_pct: 0 }])}>
              {t("register.addCrop")}
            </button>
            <button className="btn btn-primary btn-lg" type="submit" disabled={sending}>
              {t("register.submit")}
            </button>
          </div>
        </form>
      </section>

      <aside className="card" aria-labelledby="reg-next">
        <h2 className="card-title" id="reg-next">{t("register.nextTitle")}</h2>
        <ol className="steps-list">
          <li>{t("register.next1")}</li>
          <li>{t("register.next2")}</li>
          <li>{t("register.next3")}</li>
        </ol>
      </aside>
    </div>
  );
}
