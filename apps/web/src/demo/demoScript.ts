/**
 * C7 Demo mode — guided walkthrough of the seed scenario's `demo_script` (6 steps).
 *
 * Source of truth for step copy: `packages/contracts/fixtures/demo-scenario.json`
 * (`demo_script` array). This module is a pure presentation-layer mirror so the
 * web app runs even before the backend (Task B) lands. No secrets, no API imports.
 *
 * Budget: start -> finish must complete in < 4 minutes (240 s). Each step carries
 * an `estimatedSecs` figure; the sum must stay under budget (asserted in tests).
 */

export const DEMO_BUDGET_SECS = 240;

/** Simulated clock seed — mirrors `demo-scenario.json#/now`. */
export const SIM_CLOCK_START = "2026-09-14T06:00:00+05:30";

export type DemoActionId =
  | "compare"
  | "urgent-request"
  | "replan-calls"
  | "night-protocol"
  | "harvest-buffer"
  | "audit";

export interface DemoStep {
  step: number;
  actionId: DemoActionId;
  titleEn: string;
  titleTe: string;
  whatEn: string;
  whatTe: string;
  actionLabelEn: string;
  actionLabelTe: string;
  /** Human-readable API calls this step triggers (shown in UI + docs). */
  apiCalls: string[];
  /** Simulated hours to advance when the step completes. */
  advanceHours?: number;
  /** Wall-clock estimate for a presenter clicking through (seconds). */
  estimatedSecs: number;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    actionId: "compare",
    titleEn: "Fair roster: equal-water beats equal-hours",
    titleTe: "న్యాయమైన రోస్టర్: సమాన-గంటల కంటే సమాన-నీరు మేలు",
    whatEn:
      "Coordinator compares equal-hours vs equal-water for release window rw1. Tail outlets o7/o8 jump from ~45% to over 90% need met.",
    whatTe:
      "విడుదల విండో rw1 కోసం సమాన-గంటలు vs సమాన-నీరు పద్ధతులను సమన్వయకర్త పోలుస్తారు. చివరి ఔట్‌లెట్లు o7/o8 అవసరం ~45% నుండి 90% పైగా చేరుతుంది.",
    actionLabelEn: "Compare rosters",
    actionLabelTe: "రోస్టర్లను పోల్చండి",
    apiCalls: [
      "POST /api/rosters/propose (equal_hours)",
      "POST /api/rosters/propose (equal_water)",
    ],
    advanceHours: 2,
    estimatedSecs: 30,
  },
  {
    step: 2,
    actionId: "urgent-request",
    titleEn: "Urgent Telugu voice request from head-reach farmer",
    titleTe: "మొదటి రైతు నుండి తెలుగు వాయిస్ అత్యవసర అభ్యర్థన",
    whatEn:
      "f1 (head reach, rice at flowering) raises an urgent request by Telugu voice. The agent recommends partial approval; the coordinator approves and the volume is deducted from f1's future quota.",
    whatTe:
      "f1 (మొదలు, పూత దశలో వరి) తెలుగు వాయిస్ ద్వారా అత్యవసర అభ్యర్థన చేస్తారు. ఏజెంట్ పాక్షిక ఆమోదం సిఫార్సు చేస్తుంది; సమన్వయకర్త ఆమోదిస్తారు, పరిమాణం f1 భవిష్యత్ కోటా నుండి తగ్గుతుంది.",
    actionLabelEn: "Raise & decide urgent request",
    actionLabelTe: "అత్యవసర అభ్యర్థనను నమోదు చేసి నిర్ణయించండి",
    apiCalls: [
      "POST /api/intake (Telugu voice)",
      "POST /api/requests",
      "POST /api/requests/:id/decide (approve)",
    ],
    advanceHours: 3,
    estimatedSecs: 35,
  },
  {
    step: 3,
    actionId: "replan-calls",
    titleEn: "Re-plan roster and call affected farmers",
    titleTe: "రోస్టర్‌ను తిరిగి ప్లాన్ చేసి రైతులకు కాల్ చేయండి",
    whatEn:
      "Roster is re-planned and the caller agent rings every affected farmer. f5 and f8 (no smartphone) get voice calls; everyone else gets voice + WhatsApp.",
    whatTe:
      "రోస్టర్ తిరిగి ప్లాన్ చేయబడుతుంది, కాలర్ ఏజెంట్ ప్రభావిత రైతులందరికీ కాల్ చేస్తుంది. f5, f8 (స్మార్ట్‌ఫోన్ లేదు)కు వాయిస్ కాల్స్; మిగతా అందరికీ వాయిస్ + వాట్సాప్.",
    actionLabelEn: "Re-plan & notify farmers",
    actionLabelTe: "తిరిగి ప్లాన్ చేసి రైతులకు తెలియజేయండి",
    apiCalls: [
      "POST /api/rosters/propose",
      "POST /api/rosters/:id/approve",
      "GET /api/contacts",
    ],
    advanceHours: 5,
    estimatedSecs: 30,
  },
  {
    step: 4,
    actionId: "night-protocol",
    titleEn: "Night release protocol for rw2",
    titleTe: "rw2 కోసం రాత్రి విడుదల ప్రోటోకాల్",
    whatEn:
      "rw2 starts at 19:00 IST, so the night-release protocol fires: WhatsApp message plus a warning call one hour before water arrives.",
    whatTe:
      "rw2 రాత్రి 7 గంటలకు (IST) మొదలవుతుంది, కాబట్టి రాత్రి-విడుదల ప్రోటోకాల్: వాట్సాప్ సందేశం + నీరు రావడానికి గంట ముందు హెచ్చరిక కాల్.",
    actionLabelEn: "Advance clock & fire night protocol",
    actionLabelTe: "గడియారం ముందుకు + రాత్రి ప్రోటోకాల్",
    apiCalls: ["POST /api/demo/advance", "GET /api/contacts"],
    advanceHours: 12,
    estimatedSecs: 25,
  },
  {
    step: 5,
    actionId: "harvest-buffer",
    titleEn: "Harvest declared, buffer shared transparently",
    titleTe: "పంట కోత ప్రకటన, బఫర్ పారదర్శక పంపిణీ",
    whatEn:
      "f3 declares cotton harvested, so the remaining quota moves to the buffer. f7 requests buffer water; every move stays visible on the portal.",
    whatTe:
      "f3 పత్తి కోత ప్రకటిస్తారు, మిగిలిన కోటా బఫర్‌కు వెళ్తుంది. f7 బఫర్ నీటిని అడుగుతారు; ప్రతి చర్య పోర్టల్‌లో కనిపిస్తుంది.",
    actionLabelEn: "Release to buffer & request",
    actionLabelTe: "బఫర్‌కు విడుదల చేసి అభ్యర్థించండి",
    apiCalls: ["GET /api/ledger", "POST /api/requests (buffer)"],
    advanceHours: 24,
    estimatedSecs: 30,
  },
  {
    step: 6,
    actionId: "audit",
    titleEn: "Audit: conservation holds, fairness improves",
    titleTe: "ఆడిట్: పరిరక్షణ నిలిచింది, న్యాయం మెరుగైంది",
    whatEn:
      "Auditor checks the conservation invariant, compares Gini of need-met before/after, and writes a plain-language summary in Telugu and English.",
    whatTe:
      "ఆడిటర్ పరిరక్షణ నియమాన్ని తనిఖీ చేసి, ముందు/తర్వాత అవసరాల గినీ (Gini)ని పోల్చి, తెలుగు + ఇంగ్లీషులో సరళ సారాంశం రాస్తారు.",
    actionLabelEn: "Run audit & finish",
    actionLabelTe: "ఆడిట్ చేసి ముగించండి",
    apiCalls: ["GET /api/audit", "GET /api/events", "GET /api/ledger"],
    estimatedSecs: 20,
  },
];

export function totalEstimatedSecs(steps: DemoStep[] = DEMO_STEPS): number {
  return steps.reduce((sum, s) => sum + s.estimatedSecs, 0);
}

/** mm:ss formatter for the presenter timer. */
export function formatElapsed(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const mm = String(Math.floor(s / 60)).padStart(1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function stepByNumber(n: number): DemoStep | undefined {
  return DEMO_STEPS.find((s) => s.step === n);
}
