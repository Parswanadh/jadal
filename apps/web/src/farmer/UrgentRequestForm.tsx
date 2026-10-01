import { useState } from "react";
import type { FormEvent } from "react";
import { Channel, RequestType } from "@jadal/contracts";
import type { CropPlan } from "@jadal/contracts";
import { useI18n } from "../i18n/I18nContext";
import type { ChannelName, FarmerApi, RequestTypeName } from "../api/client";
import { validateRequest } from "./validate";

const TYPE_OPTIONS: RequestTypeName[] = [RequestType.Enum.urgent, RequestType.Enum.buffer];
const CHANNEL_OPTIONS: ChannelName[] = [Channel.Enum.portal, Channel.Enum.voice, Channel.Enum.whatsapp, Channel.Enum.sms];

export default function UrgentRequestForm({
  api,
  farmerId,
  cropPlans,
  onRaised,
}: {
  api: FarmerApi;
  farmerId: string;
  cropPlans: CropPlan[];
  onRaised: () => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<RequestTypeName>("urgent");
  const [volume, setVolume] = useState("");
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState<ChannelName>("portal");
  const [cropPlanId, setCropPlanId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);

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
        channel,
        crop_plan_id: cropPlanId.length > 0 ? cropPlanId : undefined,
      });
      setDone(true);
      setVolume("");
      setReason("");
      onRaised();
    } catch {
      setErrors(["app.error"]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="fp-card" aria-labelledby="fp-urg-title">
      <h2 id="fp-urg-title">{t("urgent.title")}</h2>
      <p>{t("urgent.intro")}</p>
      {done && (
        <div className="fp-success" role="status">
          {t("urgent.success")}
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
          <label htmlFor="fp-urg-type">{t("urgent.type")}</label>
          <select id="fp-urg-type" value={type} onChange={(e) => setType(e.target.value as RequestTypeName)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === "urgent" ? t("urgent.typeUrgent") : t("urgent.typeBuffer")}
              </option>
            ))}
          </select>
        </div>
        <div className="fp-field">
          <label htmlFor="fp-urg-crop">
            {t("urgent.cropPlan")} ({t("app.optional")})
          </label>
          <select id="fp-urg-crop" value={cropPlanId} onChange={(e) => setCropPlanId(e.target.value)}>
            <option value="">—</option>
            {cropPlans.map((c) => (
              <option key={c.id} value={c.id}>
                {c.crop} · {c.sowing_date}
              </option>
            ))}
          </select>
        </div>
        <div className="fp-field">
          <label htmlFor="fp-urg-vol">{t("urgent.volume")}</label>
          <input id="fp-urg-vol" type="number" min="0" step="10" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-urg-reason">{t("urgent.reason")}</label>
          <textarea id="fp-urg-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("urgent.reasonHint")} />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-urg-channel">{t("urgent.channel")}</label>
          <select id="fp-urg-channel" value={channel} onChange={(e) => setChannel(e.target.value as ChannelName)}>
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button className="fp-btn" type="submit" disabled={sending}>
          {t("urgent.submit")}
        </button>
      </form>
    </section>
  );
}
