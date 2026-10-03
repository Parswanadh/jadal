/**
 * Demo mode: the guided story, in six steps.
 *
 * The words for each step (title, one sentence, outcome) live in the language
 * files under `demo.steps.<n>`. This module holds only the order, the screen
 * each step links to, and the timing. The scenario itself comes from the
 * fixture `packages/contracts/fixtures/demo-scenario.json` (`demo_script`).
 *
 * Budget: start to finish must fit under four minutes (240 s). Each step has
 * an `estimatedSecs` figure; the sum is asserted in the tests.
 */

export const DEMO_BUDGET_SECS = 240;

/** Simulated clock seed. Mirrors `demo-scenario.json#/now`. */
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
  /** The screen where the result of this step can be seen. */
  seeIt: string;
  /** Simulated hours to advance when the step completes. */
  advanceHours?: number;
  /** Wall-clock estimate for a presenter clicking through (seconds). */
  estimatedSecs: number;
}

export const DEMO_STEPS: DemoStep[] = [
  { step: 1, actionId: "compare", seeIt: "/coordinator?tab=roster", advanceHours: 2, estimatedSecs: 30 },
  { step: 2, actionId: "urgent-request", seeIt: "/coordinator?tab=requests", advanceHours: 3, estimatedSecs: 35 },
  { step: 3, actionId: "replan-calls", seeIt: "/phone", advanceHours: 5, estimatedSecs: 30 },
  { step: 4, actionId: "night-protocol", seeIt: "/phone", advanceHours: 12, estimatedSecs: 25 },
  { step: 5, actionId: "harvest-buffer", seeIt: "/farmer?tab=pool", advanceHours: 24, estimatedSecs: 30 },
  { step: 6, actionId: "audit", seeIt: "/coordinator?tab=accounts", estimatedSecs: 20 },
];

export function totalEstimatedSecs(steps: DemoStep[] = DEMO_STEPS): number {
  return steps.reduce((sum, s) => sum + s.estimatedSecs, 0);
}

/** m:ss formatter for the presenter timer. */
export function formatElapsed(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const mm = String(Math.floor(s / 60));
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}


