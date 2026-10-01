import { describe, expect, it } from "vitest";
import en from "./en.json";
import te from "./te.json";
import { fixtureText } from "./fixtureText";
import { MOCK_FIXTURE_TEXT } from "../api/mock";
import { DEMO_INTAKE_TEXT } from "../demo/api";

function makeT(dict: Record<string, unknown>) {
  return (path: string): string => {
    let node: unknown = dict;
    for (const part of path.split(".")) {
      if (typeof node !== "object" || node === null) return path;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : path;
  };
}

const tEn = makeT(en as unknown as Record<string, unknown>);
const tTe = makeT(te as unknown as Record<string, unknown>);
const enFixture = en.fixture as Record<string, string>;
const teFixture = te.fixture as Record<string, string>;

describe("fixtureText", () => {
  it("renders the mock's own reasons in the active language", () => {
    // Each mock string must equal its `fixture.*` value, or the lookup misses.
    for (const [name, text] of Object.entries(MOCK_FIXTURE_TEXT)) {
      expect(enFixture[name], name).toBe(text);
      expect(fixtureText(text, tEn), name).toBe(enFixture[name]);
      expect(fixtureText(text, tTe), name).toBe(teFixture[name]);
    }
  });

  it("renders the demo's Telugu voice intake in the active language", () => {
    expect(fixtureText(DEMO_INTAKE_TEXT, tEn)).toBe(en.fixture.reasonPaddyFlowering);
    expect(fixtureText(DEMO_INTAKE_TEXT, tTe)).toBe(te.fixture.reasonPaddyFlowering);
  });

  it("leaves a real farmer's own words untouched", () => {
    expect(fixtureText("My pump broke, please help.", tTe)).toBe("My pump broke, please help.");
  });
});
