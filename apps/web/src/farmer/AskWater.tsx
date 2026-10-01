import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CropPlan, WaterRequest } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import type { FarmerApi, RequestTypeName } from "./farmerApi";
import { validateRequest } from "./validate";
import { statusTone } from "./status";

const TYPES: RequestTypeName[] = ["urgent", "buffer"];

interface Props {
  api: FarmerApi;
  farmerId: string;
  cropPlans: CropPlan[];
  refreshKey: number;
  onRaised: () => void;
}

/** A farmer asks for extra water, and sees what happened to earlier requests. */
export default function AskWater({ api, farmerId, cropPlans, refreshKey, onRaised }: Props) {
  const { t } = useI18n();
  const f = useFormat();
  const [type, setType] = useState<RequestTypeName>("urgent");
  const [volume, setVolume] = useState("");
  const [reason, setReason] = useState("");
  const [cropPlanId, setCropPlanId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [mine, setMine] = useState<WaterRequest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listRequests()
      .then((all) => {
        if (!cancelled) setMine(all.filter((r) => r.farmer_id === farmerId));
      })
      .catch(() => {
        if (!cancelled) setMine([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, farmerId, refreshKey]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const errs = validateRequest(Number(volume), reason);
    setErrors(errs);
    setDone(false);
    if (errs.length > 0) return;
    setSending(true);
    try {
      await api.raiseRequest({
        farmer_id: farmerId,
        type,
        volume_m3: Number(volume),
        reason: reason.trim(),
        channel: "portal",
        crop_plan_id: cropPlanId.length > 0 ? cropPlanId : undefined,
      });
      setDone(true);
      setVolume("");
      setReason("");
      onRaised();
    } catch {
      setErrors(["common.loadError"]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-main-side">
      <section className="card" aria-labelledby="ask-title">
        <h2 className="card-title" id="ask-title">{t("ask.title")}</h2>
        <p className="card-sub">{t("ask.intro")}</p>
        {done && (
          <div className="notice notice-ok" role="status">
            <p>{t("ask.success")}</p>
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
          <fieldset className="choice-group">
            <legend className="field-label">{t("ask.type")}</legend>
            {TYPES.map((o) => (
              <label key={o} className={`choice${type === o ? " selected" : ""}`}>
                <input type="radio" name="ask-type" value={o} checked={type === o} onChange={() => setType(o)} />
                <span>
                  <strong>{t(`ask.types.${o}.title`)}</strong>
                  <span className="muted small">{t(`ask.types.${o}.body`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="ask-crop">{t("ask.crop")}</label>
              <select id="ask-crop" value={cropPlanId} onChange={(e) => setCropPlanId(e.target.value)}>
                <option value="">{t("ask.allCrops")}</option>
                {cropPlans.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t("ask.cropOption", { crop: f.crop(c.crop), date: f.dateOnly(c.sowing_date) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ask-volume">{t("ask.volume")}</label>
              <input id="ask-volume" type="number" min="0" step="10" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />
              <UnitHint />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ask-reason">{t("ask.reason")}</label>
            <textarea id="ask-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ask.reasonHint")} />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={sending || !farmerId}>
            {t("ask.submit")}
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="ask-mine">
        <h2 className="card-title" id="ask-mine">{t("ask.mineTitle")}</h2>
        {mine === null && <p className="muted" role="status">{t("common.loading")}</p>}
        {mine !== null && mine.length === 0 && <EmptyState title={t("ask.mineEmptyTitle")} body={t("ask.mineEmptyBody")} />}
        {mine !== null && mine.length > 0 && (
          <ul className="plain-list">
            {mine.map((r) => (
              <li key={r.id}>
                <span className="row-between">
                  <strong>{t("ask.mineLine", { type: t(`reqType.${r.type}`), m3: f.m3(r.volume_m3) })}</strong>
                  <span className={`pill pill-${statusTone(r.status)}`}>{t(`reqStatus.${r.status}`)}</span>
                </span>
                <span className="muted small">{f.dateTime(r.raised_at)}</span>
                {r.coordinator_decision && (
                  <span className="small">
                    {t(r.coordinator_decision.decision === "approve" ? "ask.decisionApproved" : "ask.decisionRejected", {
                      m3: f.m3(r.coordinator_decision.volume_m3),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
