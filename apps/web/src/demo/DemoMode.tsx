import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import PageHeader from "../components/PageHeader";
import {
  DEMO_BUDGET_SECS,
  DEMO_STEPS,
  SIM_CLOCK_START,
  formatElapsed,
  totalEstimatedSecs,
} from "./demoScript";
import {
  compareRosters,
  demoAdvance,
  demoReset,
  fetchAudit,
  fetchEvents,
  fireNightProtocol,
  mockEvent,
  raiseUrgentRequest,
  releaseToBuffer,
  replanAndNotify,
  type ApiResult,
  type AuditResult,
  type DemoEvent,
} from "./api";
import "./DemoMode.css";

type Lang = "en" | "te";

function show(lang: Lang, en: string, te: string): string {
  return lang === "te" ? te : en;
}

function describeResult(step: number, payload: unknown): string {
  try {
    if (step === 1) {
      const r = payload as { equalHoursGini: number; equalWaterGini: number; tailBeforePct: number; tailAfterPct: number };
      return `Gini ${r.equalHoursGini} → ${r.equalWaterGini}; tail o7/o8 ${r.tailBeforePct}% → ${r.tailAfterPct}% need met.`;
    }
    if (step === 2) {
      const r = payload as { requestId: string; recommendation: string; decision: string };
      return `${r.requestId}: ${r.recommendation}; ${r.decision}.`;
    }
    if (step === 3) {
      const r = payload as { callsPlaced: number; voiceOnly: string[]; whatsapp: string[] };
      return `${r.callsPlaced} calls placed. Voice-only: ${r.voiceOnly.join(", ")}. Voice+WhatsApp: ${r.whatsapp.join(", ")}.`;
    }
    if (step === 4) {
      const r = payload as { windowId: string; startsAtIst: string; warningsSent: number };
      return `${r.windowId} starts ${r.startsAtIst}; ${r.warningsSent} contacts on record for the 1h-before warning.`;
    }
    if (step === 5) {
      const r = payload as { bufferM3: number; requester: string; requestedM3: number | null };
      const asked = r.requestedM3 === null ? "" : ` requested ${r.requestedM3} m³`;
      return `Buffer holds ${r.bufferM3} m³; requester ${r.requester}${asked}.`;
    }
    const r = payload as AuditResult;
    return r.summaryEn;
  } catch {
    return "Done.";
  }
}

export default function DemoMode() {
  const { lang, t: tr } = useI18n();
  const [completed, setCompleted] = useState(0); // 0..6
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready. Press Start demo. / సిద్ధంగా ఉంది. ప్రారంభించండి.");
  const [simNow, setSimNow] = useState<string>(SIM_CLOCK_START);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [replayCount, setReplayCount] = useState(0);
  const [results, setResults] = useState<Record<number, string>>({});
  const [offline, setOffline] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const timerRef = useRef<number | null>(null);
  const eventsRef = useRef<DemoEvent[]>([]);

  const budget = DEMO_BUDGET_SECS;
  const estimate = useMemo(() => totalEstimatedSecs(), []);
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

  // Timeline = server events (GET /api/events) plus the markers the walkthrough adds, in time order.
  const refreshEvents = useCallback(async (local: DemoEvent[]) => {
    const res = await fetchEvents();
    const server = res.data ?? [];
    setEvents([...server, ...local].sort((a, b) => a.at.localeCompare(b.at)));
  }, []);

  const noteOffline = useCallback((mocked: boolean) => {
    if (mocked) setOffline(true);
  }, []);

  async function handleStart() {
    setBusy(true);
    setStatus("Resetting to seed scenario… / సీడ్ దృశ్యానికి రీసెట్ చేస్తున్నాం…");
    const r = await demoReset();
    noteOffline(r.mocked);
    setSimNow(SIM_CLOCK_START);
    eventsRef.current = [];
    setEvents([]);
    setResults({});
    setAudit(null);
    setCompleted(0);
    setElapsed(0);
    setStarted(true);
    setBusy(false);
    setStatus("Demo reset. Step 1 of 6 ready. / డెమో రీసెట్ అయింది. 6లో 1వ దశ సిద్ధం.");
    stepHeadingRef.current?.focus();
  }

  async function handleReset() {
    setBusy(true);
    const r = await demoReset();
    noteOffline(r.mocked);
    eventsRef.current = [];
    setEvents([]);
    setResults({});
    setAudit(null);
    setCompleted(0);
    setElapsed(0);
    setStarted(false);
    setSimNow(SIM_CLOCK_START);
    setBusy(false);
    setStatus("Reset done. / రీసెట్ పూర్తయింది.");
  }

  async function advanceClock(hours: number) {
    setBusy(true);
    const r = await demoAdvance(hours);
    noteOffline(r.mocked);
    if (r.data?.now) setSimNow(r.data.now);
    else setSimNow((prev) => new Date(new Date(prev).getTime() + hours * 3600_000).toISOString());
    const clockEv = mockEvent("system.clock", `Clock advanced +${hours}h`, `గడియారం +${hours}గం ముందుకు`);
    const nextLocal = [...eventsRef.current, clockEv];
    eventsRef.current = nextLocal;
    await refreshEvents(nextLocal);
    setBusy(false);
  }

  async function runStep(stepNum: number): Promise<void> {
    const step = DEMO_STEPS[stepNum - 1];
    if (!step) return;
    setBusy(true);
    setStatus(`Running step ${stepNum}… / దశ ${stepNum} నడుస్తోంది…`);
    let result: ApiResult<unknown>;
    if (step.actionId === "compare") result = await compareRosters();
    else if (step.actionId === "urgent-request") result = await raiseUrgentRequest();
    else if (step.actionId === "replan-calls") result = await replanAndNotify();
    else if (step.actionId === "night-protocol") result = await fireNightProtocol();
    else if (step.actionId === "harvest-buffer") result = await releaseToBuffer();
    else {
      const r = await fetchAudit();
      if (r.data) setAudit(r.data);
      result = r;
    }
    const payload = result.data;
    const mocked = result.mocked;
    noteOffline(mocked);
    const text = payload ? describeResult(stepNum, payload) : `Error: ${result.error ?? "no response"}`;
    const withClock = step.advanceHours ? `${text} Clock +${step.advanceHours}h.` : text;
    setResults((prev) => ({ ...prev, [stepNum]: withClock }));
    if (step.advanceHours) {
      const adv = await demoAdvance(step.advanceHours);
      noteOffline(adv.mocked);
      if (adv.data?.now) setSimNow(adv.data.now);
    }
    const ev = mockEvent(`demo.step${stepNum}`, `Step ${stepNum}: ${step.titleEn} — ${text}`, `దశ ${stepNum}: ${step.titleTe} — ${text}`);
    const next = [...eventsRef.current, ev];
    eventsRef.current = next;
    await refreshEvents(next);
    setCompleted(stepNum);
    setBusy(false);
    if (stepNum >= DEMO_STEPS.length) {
      setStatus(`Demo finished in ${formatElapsed(elapsed)}. / డెమో ${formatElapsed(elapsed)}లో ముగిసింది.`);
    } else {
      setStatus(`Step ${stepNum} done. Step ${stepNum + 1} of 6 ready. / దశ ${stepNum} పూర్తి. తర్వాత దశ సిద్ధం.`);
    }
    stepHeadingRef.current?.focus();
  }

  async function handleRunAll() {
    if (!started) await handleStart();
    for (let n = completed + 1; n <= DEMO_STEPS.length; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      await runStep(n);
    }
  }

  const nextStep = DEMO_STEPS[completed];
  const overBudget = elapsed > budget;

  return (
    <section className="demo" aria-labelledby="demo-title">
      <PageHeader
        eyebrow={tr("page.demo.eyebrow")}
        title={tr("page.demo.title")}
        lead={tr("page.demo.lead")}
        titleId="demo-title"
        titleRef={stepHeadingRef}
        focusable
      />
      <p className="demo__sub">
        {show(
          lang,
          `Seed: Kondaveedu Minor near Guntur. Budget: start → finish under 4:00. Script estimate ${formatElapsed(estimate)}.`,
          `సీడ్: గుంటూరు దగ్గర కొండవీడు మైనర్. బడ్జెట్: ప్రారంభం → ముగింపు 4:00 లోపు. అంచనా ${formatElapsed(estimate)}.`,
        )}
      </p>

      <div className="demo__statusbar" role="status" aria-live="polite">
        <span>{status}</span>
        {offline && <span className="demo__badge">mock data · మాక్ డేటా</span>}
      </div>

      <div className="demo__meta">
        <div className="demo__timer" aria-label="Elapsed time">
          <strong>{formatElapsed(elapsed)}</strong>
          <span> / 4:00</span>
          {overBudget && <span className="demo__warn"> over budget!</span>}
        </div>
        <ol className="demo__steps" aria-label="Demo progress">
          {DEMO_STEPS.map((s) => (
            <li key={s.step} className={s.step <= completed ? "done" : s.step === completed + 1 ? "now" : ""} aria-current={s.step === completed + 1 && !finished ? "step" : undefined}>
              <span aria-hidden="true">{s.step <= completed ? "✓" : s.step}</span>
              <span className="demo__sr">{`Step ${s.step} ${s.step <= completed ? "done" : "pending"}`}</span>
            </li>
          ))}
        </ol>
        <progress value={completed} max={DEMO_STEPS.length} aria-label="Steps completed">
          {completed}/{DEMO_STEPS.length}
        </progress>
      </div>

      <div className="demo__actions" role="group" aria-label="Demo run controls">
        {!started && (
          <button type="button" onClick={handleStart} disabled={busy}>
            {show(lang, "Start demo", "డెమో ప్రారంభించండి")}
          </button>
        )}
        {started && !finished && nextStep && (
          <button type="button" onClick={() => runStep(nextStep.step)} disabled={busy}>
            {busy ? show(lang, "Working…", "పని జరుగుతోంది…") : show(lang, `Next: ${nextStep.actionLabelEn} (${nextStep.step}/6)`, `${nextStep.actionLabelTe} (${nextStep.step}/6)`)}
          </button>
        )}
        {started && !finished && (
          <button type="button" onClick={handleRunAll} disabled={busy}>
            {show(lang, "Run all to finish", "అన్నీ పూర్తి చేయండి")}
          </button>
        )}
        <button type="button" onClick={handleReset} disabled={busy}>
          {show(lang, "Reset", "రీసెట్")}
        </button>
      </div>


      <div className="demo__cols">
        <div className="demo__col">
      <section className="demo__script" aria-labelledby="demo-script">
        <h2 id="demo-script">{show(lang, "Guided walkthrough", "మార్గదర్శక నడక")}</h2>
        <ol>
          {DEMO_STEPS.map((s) => {
            const done = s.step <= completed;
            const current = s.step === completed + 1 && started && !finished;
            return (
              <li key={s.step} className={done ? "done" : current ? "now" : ""}>
                <h3>
                  {s.step}. {show(lang, s.titleEn, s.titleTe)}
                </h3>
                <p>{show(lang, s.whatEn, s.whatTe)}</p>
                <p className="demo__hint">
                  <code>{s.apiCalls.join(" · ")}</code>
                  {s.advanceHours ? ` · +${s.advanceHours}h` : ""} · ~{s.estimatedSecs}s
                </p>
                {results[s.step] && <p className="demo__result">{results[s.step]}</p>}
                {current && (
                  <button type="button" onClick={() => runStep(s.step)} disabled={busy}>
                    {show(lang, s.actionLabelEn, s.actionLabelTe)}
                  </button>
                )}
                {done && <p aria-label={`Step ${s.step} done`}>✓</p>}
              </li>
            );
          })}
        </ol>
      </section>
        </div>
        <div className="demo__col">
      <section className="demo__clock" aria-labelledby="demo-clock">
        <h2 id="demo-clock">{show(lang, "Simulated clock", "అనుకరణ గడియారం")}</h2>
        <p>
          <time dateTime={simNow}>{simNow}</time>
        </p>
        <div className="demo__actions" role="group" aria-label="Advance clock">
          {[1, 6, 24].map((h) => (
            <button key={h} type="button" onClick={() => advanceClock(h)} disabled={busy || !started}>
              {show(lang, `Advance +${h}h`, `+${h}గం ముందుకు`)}
            </button>
          ))}
        </div>
        <p className="demo__hint">{show(lang, "Calls POST /api/demo/advance.", "POST /api/demo/advance ను పిలుస్తుంది.")}</p>
      </section>

      {audit && (
        <section className="demo__audit" aria-labelledby="demo-audit">
          <h2 id="demo-audit">{show(lang, "Audit summary", "ఆడిట్ సారాంశం")}</h2>
          <p>{show(lang, audit.summaryEn, audit.summaryTe)}</p>
          <dl>
            <dt>Gini</dt>
            <dd>
              {audit.giniBefore} → {audit.giniAfter}
            </dd>
            <dt>{show(lang, "Conservation", "పరిరక్షణ")}</dt>
            <dd>{audit.conservationOk ? "✓ holds / నిలిచింది" : "✗ violated / ఉల్లంఘన"}</dd>
          </dl>
        </section>
      )}

      <section className="demo__timeline" aria-labelledby="demo-events">
        <h2 id="demo-events">{show(lang, `Event timeline (${events.length})`, `ఘటనల కాలరేఖ (${events.length})`)}</h2>
        {events.length === 0 ? (
          <p className="demo__hint">{show(lang, "No events yet. Start the demo to replay the event log.", "ఇంకా ఘటనలు లేవు. డెమో ప్రారంభించి లాగ్ చూడండి.")}</p>
        ) : (
          <>
            <label className="demo__label">
              {show(lang, `Replay first ${replayCount} of ${events.length}`, `మొదటి ${replayCount}/${events.length} చూపించు`)}
              <input
                type="range"
                min={0}
                max={events.length}
                value={replayCount}
                onChange={(e) => setReplayCount(Number(e.target.value))}
                aria-valuetext={`${replayCount} of ${events.length} events`}
              />
            </label>
            <ol>
              {visibleEvents.map((ev) => (
                <li key={ev.id}>
                  <span className="demo__etype">{ev.type}</span> <time dateTime={ev.at}>{ev.at}</time>
                  <p>{show(lang, ev.summaryEn, ev.summaryTe)}</p>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="demo__hint">GET /api/events</p>
      </section>
        </div>
      </div>
    </section>
  );
}
