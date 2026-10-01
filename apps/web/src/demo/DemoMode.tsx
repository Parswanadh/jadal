import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type AuditResult,
  type DemoEvent,
} from "./api";
import "./DemoMode.css";

type Lang = "both" | "en" | "te";
type Theme = "auto" | "light" | "dark";

function show(lang: Lang, en: string, te: string): string {
  if (lang === "en") return en;
  if (lang === "te") return te;
  return `${en} / ${te}`;
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
      return `${r.windowId} starts ${r.startsAtIst}; ${r.warningsSent} warnings sent 1h before.`;
    }
    if (step === 5) {
      const r = payload as { releasedM3: number; requester: string };
      return `${r.releasedM3} m³ moved to buffer; requester ${r.requester}.`;
    }
    const r = payload as AuditResult;
    return r.summaryEn;
  } catch {
    return "Done.";
  }
}

export default function DemoMode() {
  const [lang, setLang] = useState<Lang>("both");
  const [theme, setTheme] = useState<Theme>("auto");
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
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

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

  useEffect(() => {
    document.title = "Jadal — Demo mode";
  }, []);

  const refreshEvents = useCallback(async (extra: DemoEvent[]) => {
    const res = await fetchEvents(extra);
    if (!res.mocked && res.data) {
      setEvents(res.data);
    } else {
      setEvents(extra);
      setOffline(true);
    }
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
    setEvents((prev) => {
      const next = [...prev, clockEv];
      eventsRef.current = next;
      return next;
    });
    setBusy(false);
  }

  async function runStep(stepNum: number): Promise<void> {
    const step = DEMO_STEPS[stepNum - 1];
    if (!step) return;
    setBusy(true);
    setStatus(`Running step ${stepNum}… / దశ ${stepNum} నడుస్తోంది…`);
    let payload: unknown = null;
    let mocked = false;
    if (step.actionId === "compare") {
      const r = await compareRosters();
      payload = r.data; mocked = r.mocked;
    } else if (step.actionId === "urgent-request") {
      const r = await raiseUrgentRequest();
      payload = r.data; mocked = r.mocked;
    } else if (step.actionId === "replan-calls") {
      const r = await replanAndNotify();
      payload = r.data; mocked = r.mocked;
    } else if (step.actionId === "night-protocol") {
      const r = await fireNightProtocol();
      payload = r.data; mocked = r.mocked;
    } else if (step.actionId === "harvest-buffer") {
      const r = await releaseToBuffer();
      payload = r.data; mocked = r.mocked;
    } else {
      const r = await fetchAudit();
      payload = r.data; mocked = r.mocked;
      if (r.data) setAudit(r.data);
    }
    noteOffline(mocked);
    const text = payload ? describeResult(stepNum, payload) : "Done.";
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
    <section className="demo" data-theme={theme} aria-labelledby="demo-title">
      <header className="demo__header">
        <div>
          <p className="demo__kicker">Jadal · Demo mode · డెమో</p>
          <h1 id="demo-title" tabIndex={-1} ref={stepHeadingRef}>
            {show(lang, "Canal demo walkthrough (6 steps)", "కాలువ డెమో నడక (6 దశలు)")}
          </h1>
          <p className="demo__sub">
            {show(
              lang,
              `Seed: Kondaveedu Minor near Guntur. Budget: start → finish under 4:00. Script estimate ${formatElapsed(estimate)}.`,
              `సీడ్: గుంటూరు దగ్గర కొండవీడు మైనర్. బడ్జెట్: ప్రారంభం → ముగింపు 4:00 లోపు. అంచనా ${formatElapsed(estimate)}.`,
            )}
          </p>
        </div>
        <div className="demo__controls" role="group" aria-label="Demo display controls">
          <label className="demo__label">
            {show(lang, "Language", "భాష")}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language / భాష">
              <option value="both">English + తెలుగు</option>
              <option value="en">English</option>
              <option value="te">తెలుగు</option>
            </select>
          </label>
          <label className="demo__label">
            {show(lang, "Theme", "థీమ్")}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme / థీమ్">
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>

      <div className="demo__statusbar" role="status" aria-live="polite">
        <span>{status}</span>
        {offline && <span className="demo__badge">offline mock data · ఆఫ్‌లైన్ డేటా</span>}
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
    </section>
  );
}
