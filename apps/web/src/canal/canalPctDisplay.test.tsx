import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import CanalVisual from "./CanalVisual";
import type { CanalVisualData } from "./types";

// SSR render of the real canal component with a supplied 280.8% planned value.
// Stubs only what I18nProvider's initial-language lookup touches in node.
beforeEach(() => {
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
  vi.stubGlobal("document", { documentElement: { lang: "en" } });
});

function dataWith(pct: number): CanalVisualData {
  return {
    canal: { id: "c1", name: "Canal", name_te: "", length_m: 3000, head_discharge_m3s: 0.1447 },
    outlets: [
      { id: "o1", canal_id: "c1", name: "Outlet 1", name_te: "", chainage_m: 0, farmer_id: "f1", farmer_name: "Farmer One", farmer_name_te: "" },
    ],
    flows: [{ outlet_id: "o1", chainage_m: 0, flow_m3s: 0.1447, loss_fraction: 0 }],
    needMet: {
      equal_hours: [{ farmer_id: "f1", outlet_id: "o1", farmer_name: "Farmer One", farmer_name_te: "", pct }],
      equal_water: [{ farmer_id: "f1", outlet_id: "o1", farmer_name: "Farmer One", farmer_name_te: "", pct: 100 }],
    },
    comparison: { equal_hours_gini: 0.0593, equal_water_gini: 0 },
    overrunSteps: [0, 1],
    overrun: {},
  };
}

function render(pct: number): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <CanalVisual initial={dataWith(pct)} />
    </I18nProvider>,
  );
}

describe("CanalVisual need-met bars above 100%", () => {
  it("clamps the bar width and labels over-allocation at 280.8%", () => {
    const html = render(280.8);
    expect(html).toContain("280.8% of need met");
    expect(html).toContain("Over-allocated");
    // The bar must be clamped to the track, never 280.8% wide.
    expect(html).toContain("width:100%");
    expect(html).not.toContain("width:280.8%");
  });

  it("labels over-allocation at 205.5% too", () => {
    const html = render(205.5);
    expect(html).toContain("205.5% of need met");
    expect(html).toContain("Over-allocated");
    expect(html).not.toContain("width:205.5%");
  });

  it("does not label exactly 100% as over-allocated", () => {
    const html = render(100);
    expect(html).toContain("100% of need met");
    expect(html).not.toContain("Over-allocated");
    expect(html).toContain("width:100%");
  });

  it("does not label a shortfall of 98% as over-allocated", () => {
    const html = render(98);
    expect(html).toContain("98% of need met");
    expect(html).not.toContain("Over-allocated");
    expect(html).toContain("width:98%");
  });
});
