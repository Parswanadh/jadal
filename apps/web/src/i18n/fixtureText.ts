import en from "./en.json";
import te from "./te.json";
import type { TVars } from "./I18nContext";

type Translate = (path: string, vars?: TVars) => string;

/**
 * Fixture copy that reaches the screens as a single free-text field
 * (`WaterRequest.reason` and `coordinator_decision.note`). The contract carries
 * one string, so the mock's own prose and the demo's voice intake cannot ship a
 * `_en`/`_te` pair inside the payload. These keys name the fixture strings; the
 * reverse map below recognises the text in either language, and the screens
 * re-render it in the active language.
 *
 * A real farmer's own words are not in this list and are shown exactly as
 * written, in whatever language the farmer used.
 */
const FIXTURE_KEYS = [
  "fixture.reasonMaizeTasseling",
  "fixture.reasonTailShortTurn",
  "fixture.reasonWaterNeeded",
  "fixture.reasonPaddyFlowering",
  "fixture.noteTailShort",
  "demo.bufferReason",
] as const;

function valueAt(dict: unknown, path: string): string | undefined {
  let node: unknown = dict;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const fixtureKeyByText = new Map<string, string>();
for (const key of FIXTURE_KEYS) {
  for (const dict of [en, te]) {
    const value = valueAt(dict, key);
    if (value && !fixtureKeyByText.has(value)) fixtureKeyByText.set(value, key);
  }
}

/** Fixture text in the active language; anything else is returned unchanged. */
export function fixtureText(text: string, t: Translate): string {
  const key = fixtureKeyByText.get(text);
  return key ? t(key) : text;
}
