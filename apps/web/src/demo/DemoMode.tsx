import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import type { TVars } from "../i18n/I18nContext";
import { useFormat } from "../lib/useFormat";
import type { Formatter } from "../lib/useFormat";
import PageHeader from "../components/PageHeader";
import { DEMO_STEPS, SIM_CLOCK_START, formatElapsed } from "./demoScript";
import {
  compareRosters,
  demoAdvance,
  demoReset,
  fetchAudit,
  fetchEvents,
  fireNightProtocol,
  localEvent,
  raiseUrgentRequest,
  releaseToBuffer,
  replanAndNotify,
  type ApiResult,
  type AuditResult,
  type BufferResult,
  type CompareResult,
  type DemoEvent,
  type NightProtocolResult,
  type NotifyResult,
  type UrgentRequestResult,
} from "./api";
import "./DemoMode.css";

type Status = { key: string; vars?: TVars };
type Translate = (path: string, vars?: TVars) => string;

/** The visible outcome of a step, as a sentence in the active language. Every number comes from the API response. */
function describeOutcome(step: number, data: unknown, t: Translate, f: Formatter): string {
  switch (step) {
    case 1: {
      const r = data as CompareResult;
      return t("demo.outcome.1", {
        before: f.pct(r.tailBeforePct),
        after: f.pct(r.tailAfterPct),
        giniBefore: f.num(r.equalHoursGini, 2),
        giniAfter: f.num(r.equalWaterGini, 2),
      });
    }
    case 2: {
      const r = data as UrgentRequestResult;
      return t(r.approved ? "demo.outcome.2" : "demo.outcome.2no", { name: r.farmerName, asked: f.m3(r.askedM3), granted: f.m3(r.grantedM3) });
    }
    case 3: {
      const r = data as NotifyResult;
      return r.voiceOnly.length > 0
        ? t("demo.outcome.3", { n: r.callsPlaced, names: f.list(r.voiceOnly) })
        : t("demo.outcome.3all", { n: r.callsPlaced });
    }
    case 4: {
      const r = data as NightProtocolResult;
      return t("demo.outcome.4", { when: f.dateTime(r.startsAt), n: r.farmersWarned });
    }
    case 5: {
      const r = data as BufferResult;
      return r.requestedM3 === null
        ? t("demo.outcome.5none", { pool: f.m3(r.bufferM3) })
        : t("demo.outcome.5", { pool: f.m3(r.bufferM3), name: r.requester, asked: f.m3(r.requestedM3) });
    }
    default: {
      const r = data as AuditResult;
      return t(r.conservationOk ? "demo.outcome.6" : "demo.outcome.6bad", {
        giniBefore: f.num(r.giniBefore, 2),
        giniAfter: f.num(r.giniAfter, 2),
      });
    }
  }
}

function eventSentence(ev: DemoEvent, t: Translate, f: Formatter): string {
  if (ev.type === "demo_step") return t("demo.events.demo_step", { n: ev.step ?? 0, title: t(`demo.steps.${ev.step ?? 1}.title`) });
  if (ev.type === "demo_clock") return t("demo.events.demo_clock", { h: ev.hours ?? 0 });
  const variant = ev.approved === undefined ? "" : ev.approved ? "_yes" : "_no";
  const key = `demo.events.${ev.type}${variant}`;
  const text = t(key, {
    name: ev.name ?? t("farmer.someone"),
    m3: f.m3(ev.m3 ?? 0),
    when: ev.startIso ? f.dateTime(ev.startIso) : "",
  });
  return text === key ? t("demo.events.other") : text;
}

export default function DemoMode() {
  const { t, lang } = useI18n();
  const f = useFormat();
  const [completed, setCompleted] = useState(0); // 0..6
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ key: "demo.status.idle" });
  const [simNow, setSimNow] = useState<string>(SIM_CLOCK_START);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [replayCount, setReplayCount] = useState(0);
  const [results, setResults] = useState<Record<number, unknown>>({});
  const [failedStep, setFailedStep] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const timerRef = useRef<number | null>(null);
  const eventsRef = useRef<DemoEvent[]>([]);
  const clockRef = useRef<string>(SIM_CLOCK_START);
  const elapsedRef = useRef(0);

  const finished = completed >= DEMO_STEPS.length;
  const visibleEvents = useMemo(() => events.slice(0, replayCount), [events, replayCount]);

  useEffect(() => {
    if (started && !finished) {
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
      };
    }
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    return undefined;
  }, [started, finished]);

  useEffect(() => {
    setReplayCount(events.length);
  }, [events.length]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  const setClock = useCallback((iso: string) => {
    clockRef.current = iso;
    setSimNow(iso);
  }, []);

  // Event log = server events plus the markers the walkthrough adds, in time order.
  const refreshEvents = useCallback(async (local: DemoEvent[]) => {
    const res = await fetchEvents();
    const server = res.data ?? [];
    setEvents([...server, ...local].sort((a, b) => a.at.localeCompare(b.at)));
  }, []);

  async function handleStart() {
    setBusy(true);
    setStatus({ key: "demo.status.resetting" });
    await demoReset();
    setClock(SIM_CLOCK_START);
    eventsRef.current = [];
    setEvents([]);
    setResults({});
    setFailedStep(null);
    setAudit(null);
    setCompleted(0);
    setElapsed(0);
    setStarted(true);
    setBusy(false);
    setStatus({ key: "demo.status.ready", vars: { n: 1 } });
    titleRef.current?.focus();
  }

  async function handleReset() {
    setBusy(true);
    await demoReset();
    eventsRef.current = [];
    setEvents([]);
    setResults({});
    setFailedStep(null);
    setAudit(null);
    setCompleted(0);
    setElapsed(0);
    setStarted(false);
    setClock(SIM_CLOCK_START);
    setBusy(false);
    setStatus({ key: "demo.status.idle" });
  }

  async function advanceClock(hours: number) {
    setBusy(true);
    const r = await demoAdvance(hours);
    const next = r.data?.now ?? new Date(Date.parse(clockRef.current) + hours * 3600_000).toISOString();
    setClock(next);
    const nextLocal = [...eventsRef.current, localEvent("demo_clock", next, { hours })];
    eventsRef.current = nextLocal;
    await refreshEvents(nextLocal);
    setBusy(false);
  }

  async function runStep(stepNum: number): Promise<boolean> {
    const step = DEMO_STEPS[stepNum - 1];
    if (!step) return false;
    setBusy(true);
    setFailedStep(null);
    setStatus({ key: "demo.status.running", vars: { n: stepNum } });
    let result: ApiResult<unknown>;
    if (step.actionId === "compare") result = await compareRosters();
    else if (step.actionId === "urgent-request") result = await raiseUrgentRequest();
    else if (step.actionId === "replan-calls") result = await replanAndNotify();
    else if (step.actionId === "night-protocol") result = await fireNightProtocol();
    else if (step.actionId === "harvest-buffer") result = await releaseToBuffer(t("demo.bufferReason"));
    else {
      const r = await fetchAudit();
      if (r.data) setAudit(r.data);
      result = r;
    }
    if (!result.ok || result.data === undefined) {
      setFailedStep(stepNum);
      setStatus({ key: "demo.status.failed", vars: { n: stepNum } });
      setBusy(false);
      return false;
    }
    setResults((prev) => ({ ...prev, [stepNum]: result.data }));
    if (step.advanceHours) {
      const adv = await demoAdvance(step.advanceHours);
      if (adv.data?.now) setClock(adv.data.now);
    }
    const marker = localEvent("demo_step", clockRef.current, { step: stepNum });
    const next = [...eventsRef.current, marker];
    eventsRef.current = next;
    await refreshEvents(next);
    setCompleted(stepNum);
    setBusy(false);
    setStatus(
      stepNum >= DEMO_STEPS.length
        ? { key: "demo.status.finished", vars: { time: formatElapsed(elapsedRef.current) } }
        : { key: "demo.status.stepDone", vars: { n: stepNum, next: stepNum + 1 } },
    );
    titleRef.current?.focus();
    return true;
  }

  async function handleRunAll() {
    let from = completed;
    if (!started) {
      await handleStart();
      from = 0;
    }
    for (let n = from + 1; n <= DEMO_STEPS.length; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await runStep(n);
      if (!ok) break;
    }
  }

  const stepNow = Math.min(completed + 1, DEMO_STEPS.length);

  return (
    <section className="demo" aria-labelledby="demo-title">
      <PageHeader
        eyebrow={t("page.demo.eyebrow")}
        title={t("page.demo.title")}
        lead={t("page.demo.lead")}
        titleId="demo-title"
        titleRef={titleRef}
        focusable
      />

      <div className="demo__bar card">
        <div className="demo__bar-top">
          <div className="demo__progress-text">
            <strong>{finished ? t("demo.allDone") : t("demo.stepOf", { n: stepNow, total: DEMO_STEPS.length })}</strong>
            <span className="muted small" role="status" aria-live="polite">
              {t(status.key, status.vars)}
            </span>
          </div>
          <div className="btn-row" role="group" aria-label={t("demo.controls")}>
            {!started && (
              <button type="button" className="btn btn-primary btn-lg" onClick={handleStart} disabled={busy}>
                {t("demo.start")}
              </button>
            )}
            {started && !finished && (
              <button type="button" className="btn" onClick={handleRunAll} disabled={busy}>
                {t("demo.runAll")}
              </button>
            )}
            <button type="button" className="btn" onClick={handleReset} disabled={busy}>
              {t("demo.reset")}
            </button>
          </div>
        </div>
        <progress className="bar" value={completed} max={DEMO_STEPS.length} aria-label={t("demo.progressLabel")}>
          {completed}/{DEMO_STEPS.length}
        </progress>
      </div>

      <div className="grid grid-main-side demo__cols">
        <ol className="demo__steps" aria-label={t("demo.storyLabel")}>
          {DEMO_STEPS.map((s) => {
            const done = s.step <= completed;
            const current = s.step === completed + 1 && started && !finished;
            const outcome = results[s.step];
            return (
              <li key={s.step} className={`demo__step${done ? " done" : current ? " now" : ""}`} aria-current={current ? "step" : undefined}>
                <span className="demo__num" aria-hidden="true">
                  {done ? "✓" : s.step}
                </span>
                <div className="demo__step-body">
                  <h2 className="demo__step-title">{t(`demo.steps.${s.step}.title`)}</h2>
                  <p>{t(`demo.steps.${s.step}.what`)}</p>
                  {outcome !== undefined && <p className="demo__result">{describeOutcome(s.step, outcome, t, f)}</p>}
                  {failedStep === s.step && (
                    <p className="notice notice-crit" role="alert">
                      {t("demo.stepFailed")}
                    </p>
                  )}
                  <div className="btn-row">
                    {current && (
                      <button type="button" className="btn btn-primary" onClick={() => void runStep(s.step)} disabled={busy}>
                        {busy ? t("common.working") : t("demo.runStep")}
                      </button>
                    )}
                    <Link className="btn" to={s.seeIt}>
                      {t("demo.seeIt")}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="stack demo__side">
          <section className="card" aria-labelledby="demo-clock">
            <h2 className="card-title" id="demo-clock">{t("demo.clockTitle")}</h2>
            <p className="demo__clock">
              <time dateTime={simNow}>{f.dateTime(simNow)}</time>
            </p>
            <p className="muted small">{t("demo.clockHelp")}</p>
            <div className="btn-row" role="group" aria-label={t("demo.clockTitle")}>
              {[1, 6, 24].map((h) => (
                <button key={h} type="button" className="btn" onClick={() => void advanceClock(h)} disabled={busy || !started}>
                  {t(h === 24 ? "demo.advanceDay" : h === 1 ? "demo.advanceHour" : "demo.advanceHours", { h })}
                </button>
              ))}
            </div>
            {started && <p className="muted small demo__elapsed">{t("demo.elapsed", { time: formatElapsed(elapsed) })}</p>}
          </section>

          {audit && (
            <section className="card" aria-labelledby="demo-audit">
              <h2 className="card-title" id="demo-audit">{t("demo.auditTitle")}</h2>
              <p>{lang === "te" && audit.summaryTe ? audit.summaryTe : audit.summaryEn}</p>
            </section>
          )}

          <details className="disclosure demo__details">
            <summary>{t("demo.details")}</summary>
            <h3 className="demo__log-title">{t("demo.logTitle", { n: events.length })}</h3>
            {events.length === 0 ? (
              <p className="muted small">{t("demo.logEmpty")}</p>
            ) : (
              <>
                <label className="demo__label">
                  {t("demo.replay", { shown: replayCount, total: events.length })}
                  <input
                    type="range"
                    min={0}
                    max={events.length}
                    value={replayCount}
                    onChange={(e) => setReplayCount(Number(e.target.value))}
                    aria-valuetext={t("demo.replayValue", { shown: replayCount, total: events.length })}
                  />
                </label>
                <ol className="demo__log">
                  {visibleEvents.map((ev) => (
                    <li key={ev.id}>
                      <time dateTime={ev.at}>{f.dateTime(ev.at)}</time>
                      <p>{eventSentence(ev, t, f)}</p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </details>
        </div>
      </div>
    </section>
  );
}
