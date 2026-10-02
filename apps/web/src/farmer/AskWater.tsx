import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CropPlan, WaterRequest } from "@jadal/contracts";
import { isMockMode, sendAlert } from "../api";
import type { Allocation } from "../api/extra";
import { useI18n } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import EmptyState from "../components/EmptyState";
import UnitHint from "../components/UnitHint";
import AgentCall from "../phone/AgentCall";
import type { FarmerApi, RequestTypeName } from "./farmerApi";
import { validateRequest } from "./validate";
import { statusTone } from "./status";

const TYPES: RequestTypeName[] = ["urgent", "buffer"];

interface Props {
  api: FarmerApi;
  farmerId: string;
  farmerName: string;
  cropPlans: CropPlan[];
  refreshKey: number;
  onRaised: () => void;
}

interface AgentCallState {
  contactId: string;
  simulated: boolean;
  detail: string;
}

/** A farmer asks for extra water, and sees what happened to earlier requests. */
export default function AskWater({ api, farmerId, farmerName, cropPlans, refreshKey, onRaised }: Props) {
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
  const [allocations, setAllocations] = useState<Record<string, Allocation>>({});
  const [agentCall, setAgentCall] = useState<AgentCallState | null>(null);
  const [callFailed, setCallFailed] = useState(false);

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

  // An approved request comes with an allocation: the amount the coordinator
  // gave, and the turn window it belongs to. Both are read from the API; this
  // screen never works out a volume or a window of its own.
  useEffect(() => {
    if (!farmerId) return;
    let cancelled = false;
    api
      .allocation(farmerId)
      .then((a) => {
        if (!cancelled) setAllocations(a);
      })
      .catch(() => {
        if (!cancelled) setAllocations({});
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
    setAgentCall(null);
    setCallFailed(false);
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
      // Raising a request must not phone a real farmer. The only call a request triggers live is the
      // coordinator's, placed by the API. This alert used to go out in live mode too, and "urgent"
      // maps to the night-release warning ("be ready to open your field gate"), so the farmer's phone
      // rang with what sounded like approved water before any decision existed. Farmers are phoned
      // only after the coordinator decides. In mock mode there is no telephony: the alert is simulated
      // and the agent's reply plays on this device, which keeps the spoken-agent demo.
      if (type === "urgent" && isMockMode()) {
        try {
          const alert = await sendAlert({
            farmer_id: farmerId,
            channel: "call",
            severity: "urgent",
            message: reason.trim() || undefined,
          });
          setAgentCall({ contactId: alert.contact_id, simulated: alert.simulated, detail: alert.detail });
        } catch {
          setCallFailed(true);
        }
      }
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
        {callFailed && (
          <div className="notice notice-warn" role="alert">
            <p>{t("ask.callFailed")}</p>
          </div>
        )}
        {agentCall && (
          <AgentCall
            contactId={agentCall.contactId}
            farmerName={farmerName}
            simulated={agentCall.simulated}
            detail={agentCall.detail}
          />
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
          {type === "urgent" && <p className="field-hint">{t("ask.urgentCallNote")}</p>}
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
                {r.coordinator_decision?.decision === "approve" && allocations[r.id] && (
                  <span className="small">
                    {t("ask.allocationLine", {
                      m3: f.m3(allocations[r.id]?.volume_m3 ?? 0),
                      when: f.range(allocations[r.id]?.start ?? "", allocations[r.id]?.end ?? ""),
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
