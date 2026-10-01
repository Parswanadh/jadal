import { describe, expect, it } from "vitest";
import en from "./en.json";
import te from "./te.json";
import { fixtureText } from "./fixtureText";

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

describe("fixtureText", () => {
  it("renders a mock reason in the active language, from either direction", () => {
    expect(fixtureText(en.fixture.reasonMaizeTasseling, tEn)).toBe(en.fixture.reasonMaizeTasseling);
    expect(fixtureText(en.fixture.reasonMaizeTasseling, tTe)).toBe(te.fixture.reasonMaizeTasseling);
    // The demo's Telugu voice intake maps back to English for the coordinator.
    expect(fixtureText(te.fixture.reasonPaddyFlowering, tEn)).toBe(en.fixture.reasonPaddyFlowering);
    expect(fixtureText(te.fixture.reasonPaddyFlowering, tTe)).toBe(te.fixture.reasonPaddyFlowering);
  });

  it("leaves a real farmer's own words untouched", () => {
    expect(fixtureText("My pump broke, please help.", tTe)).toBe("My pump broke, please help.");
  });
});
