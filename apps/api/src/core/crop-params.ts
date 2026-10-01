/**
 * FAO-56 crop parameter tables — transcribed, never typed from memory.
 *
 * Every row in `CROP_PARAMS` comes from `docs/research/fao56-crop-tables.md` §2.1 (master crop
 * parameter table), which itself reproduces FAO-56 Tables 11 (growth-stage lengths), 12 (single crop
 * coefficients and crop height) and 22 (rooting depth and depletion fraction p). The `source` string
 * on each row names the FAO-56 table and the fao.org URL it was read from, so any number in the API
 * can be traced back to the primary publication.
 *
 * `docs/research/fao56-model.md` §3 contains a *second* per-crop table, but its own orchestrator
 * review (top of that file) states those values were written from model memory and are UNVERIFIED.
 * Nothing in this module is taken from there except where the verified table agrees.
 *
 * Rules honoured here (see `apps/api/.ref/B-SPEC.md`):
 *  * No invented agronomic constants — anything not in the verified table carries `// ASSUMED: <why>`.
 *  * Stage lengths are calendar days. FAO-56 2025 §6 converts thermal (GDD) lengths to days; the
 *    GDD columns (`stage_gdd`, `t_base_c`, `t_upper_c`) are therefore left undefined rather than
 *    guessed from FAO-56 2025 Tables 6.10–6.12, which are not in our verified source.
 */

import type { CropName, CropParams, CropPlan } from "@jadal/contracts";

/** Rice water-management practice, as discriminated by `CropPlan.rice_practice`. */
export type RicePractice = NonNullable<CropPlan["rice_practice"]>;

/** Growth stage, matching the `stage` union on `WeeklyNeed`. */
export type GrowthStage = "ini" | "dev" | "mid" | "late" | "done";

/** FAO-56 chapter URLs, kept as constants so every `source` string cites the same pages. */
const TAB_11 = "https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages";
const TAB_12 = "https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values";
const TAB_14 = "https://www.fao.org/3/x0490e/x0490e0b.htm#crop coefficient for the initial stage (kc ini)";
const TAB_22 = "https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)";

const src = (stages: string, kc: string, extra = ""): string =>
  `FAO-56 Tab. 11 (stage lengths) ${TAB_11}; Tab. 12 (Kc, height) ${TAB_12}${extra}; ` +
  `Tab. 22 (Zr, p) ${TAB_22}. Transcribed from docs/research/fao56-crop-tables.md §2.1 row "${stages}" (${kc}).`;

/**
 * Percolation through the puddled layer, mm/day, by rice water-management practice.
 *
 * ASSUMED: FAO-56 publishes no empirical paddy percolation rate — `docs/research/fao56-crop-tables.md`
 * §5.1 records "puddling" and percolation rates as **NOT FOUND** in the FAO-56 text, and
 * `docs/research/fao56-book-reference.md` §? repeats that finding. The same §5.1 then supplies the
 * project baseline: 2–4 mm/d on puddled black Vertisols (dominant in the AP canal command) and
 * 4–8 mm/d on light alluvium. Continuous flooding is the worst case (the field never drains, so the
 * full vertical percolation rate applies every day) and is taken as the midpoint of the puddled-
 * Vertisol range, 3.0 mm/d. Alternate Wetting and Drying deliberately drains the profile below
 * saturation between cycles, so its daily percolation is strictly lower; 1.5 mm/d is half the
 * continuous rate and the low end of the puddled-Vertisol range. Both values are engineering
 * assumptions, not FAO-56 numbers, and are isolated here so a field trial can replace them.
 */
export const PARC_PERCOLATION_MM_DAY: Record<RicePractice, number> = {
  flooded: 3.0,
  intermittent: 1.5,
};

const RICE_PRACTICE: RicePractice = "flooded";

/**
 * The full verified table, one entry per `CropName`. Rice carries a `variant` so the flooded /
 * intermittent distinction from `CropPlan.rice_practice` can be honoured (use `cropParamsFor`).
 */
export const CROP_PARAMS: Record<CropName, CropParams> = {
  rice: {
    crop: "rice",
    variant: "flooded",
    kc_ini: 1.05,
    kc_mid: 1.2,
    // 0.75 is the midpoint of Table 12's 0.60–0.90 range (docs/research/fao56-crop-tables.md §2.2 †):
    // 0.90 while the field stays flooded to near harvest, 0.60 after draining 2–3 weeks before it.
    kc_end: 0.75,
    // Kharif long-duration row (Samba Mahsuri class), §5.1 case 1.
    stage_days: { ini: 30, dev: 30, mid: 80, late: 40 },
    max_height_m: 1.0,
    root_depth_m: { min: 0.5, max: 1.0 },
    // p = 0.20 *of saturation* — FAO-56 Tab. 22 footnote 4: paddy yield collapses if the ponded
    // water disappears (§2.2 ‡).
    depletion_p: 0.2,
    percolation_mm_day: PARC_PERCOLATION_MM_DAY[RICE_PRACTICE],
    source: src(
      "Rice (Paddy) — Kharif / Long-duration",
      "Tropics, May/June transplant",
      `; Tab. 14 (Kc_ini for paddy) ${TAB_14}`,
    ),
  },
  maize: {
    crop: "maize",
    kc_ini: 0.3,
    kc_mid: 1.2,
    // Midpoint of Tab. 12's 0.60–0.35 grain-maize range (§2.2 §).
    kc_end: 0.48,
    // Tab. 11 `Maize (grain) | 20 | 35 | 40 | 30 | 125 | October | India (dry, cool)` (§5.2).
    stage_days: { ini: 20, dev: 35, mid: 40, late: 30 },
    max_height_m: 2.0,
    root_depth_m: { min: 1.0, max: 1.7 },
    depletion_p: 0.55,
    source: src("Maize (Field Grain)", "Rabi / Winter or Kharif, India dry cool"),
  },
  groundnut: {
    crop: "groundnut",
    kc_ini: 0.4,
    kc_mid: 1.15,
    kc_end: 0.6,
    // Tab. 11 `Groundnut | 25 | 35 | 45 | 25 | 130 | Dry | West Africa` (§5.3).
    stage_days: { ini: 25, dev: 35, mid: 45, late: 25 },
    max_height_m: 0.4,
    root_depth_m: { min: 0.5, max: 1.0 },
    depletion_p: 0.5,
    source: src("Groundnut (Peanut)", "Kharif rainfed-irrigated, West Africa dry"),
  },
  cotton: {
    crop: "cotton",
    kc_ini: 0.35,
    kc_mid: 1.18,
    // Tab. 12 lists 1.15–1.20 for mid and 0.70–0.50 for end; §2.2 ‖ records the midpoints used here.
    kc_end: 0.6,
    // Tab. 11 `Cotton | 30 | 50 | 60 | 55 | 195 | Mar-May | Egypt; Pakistan; Calif.` (§5.4).
    stage_days: { ini: 30, dev: 50, mid: 60, late: 55 },
    // ASSUMED: Table 12 gives cotton height as the range 1.2–1.5 m. `CropParams.max_height_m` is a
    // single number, so we take the midpoint 1.35 m. Midpoints are the project convention for
    // published ranges (the same convention `soil.ts` applies to Table 19).
    max_height_m: 1.35,
    root_depth_m: { min: 1.0, max: 1.7 },
    depletion_p: 0.65,
    source: src("Cotton", "Kharif monsoonal black soil, Egypt/Pakistan"),
  },
  chilli: {
    crop: "chilli",
    kc_ini: 0.6,
    kc_mid: 1.05,
    kc_end: 0.9,
    // ASSUMED: "Chilli" (Capsicum) is NOT FOUND as an independent FAO-56 entry; §5.5 directs us to
    // the `Sweet peppers (bell)` row and recommends a 130-day cycle for irrigated AP chilli, using
    // 30/40/40/20 rather than Tab. 11's own 25/35/40/20 = 125 d. The Kc and Zr/p values are the
    // published sweet-pepper values, unchanged.
    stage_days: { ini: 30, dev: 40, mid: 40, late: 20 },
    max_height_m: 0.7,
    root_depth_m: { min: 0.5, max: 1.0 },
    depletion_p: 0.3,
    source:
      `FAO-56 has no chilli row. Tab. 11 ${TAB_11} row "Sweet peppers (bell)" with the AP 130-day ` +
      `cycle recommended in docs/research/fao56-crop-tables.md §5.5; Tab. 12 (Kc, height) ${TAB_12}; ` +
      `Tab. 22 (Zr, p) ${TAB_22}.`,
  },
  sugarcane: {
    crop: "sugarcane",
    kc_ini: 0.4,
    kc_mid: 1.25,
    kc_end: 0.75,
    // Tab. 11 `Sugarcane, virgin | 50 | 70 | 220 | 140 | 480 | Tropics` (§5.6 row 1). The ratoon row
    // (30/50/180/60 = 320 d, §5.6 row 2) is identical in every Kc, height, Zr and p value and is not
    // reachable from `CropPlan`, which carries no ratoon flag; the virgin cycle is the default.
    stage_days: { ini: 50, dev: 70, mid: 220, late: 140 },
    max_height_m: 3.0,
    root_depth_m: { min: 1.2, max: 2.0 },
    depletion_p: 0.65,
    source: src("Sugarcane (Virgin)", "Annual / perennial planted, Tropics"),
  },
  greengram: {
    crop: "greengram",
    kc_ini: 0.4,
    kc_mid: 1.05,
    kc_end: 0.35,
    // Tab. 11 `Green gram, cowpeas | 20 | 30 | 30 | 20 | 110 | March | Mediterranean` (§5.7).
    stage_days: { ini: 20, dev: 30, mid: 30, late: 20 },
    max_height_m: 0.4,
    root_depth_m: { min: 0.6, max: 1.0 },
    depletion_p: 0.45,
    source: src("Green Gram (Moong)", "Rabi / summer short-duration pulse, Mediterranean"),
  },
  blackgram: {
    crop: "blackgram",
    kc_ini: 0.4,
    kc_mid: 1.15,
    kc_end: 0.35,
    // ASSUMED: black gram (Vigna mungo) is **NOT FOUND** in FAO-56 (§2.1 marks it NOT FOUND, §5.7
    // spells out the proxy). Stage lengths are Tab. 11 `Beans (dry) (Pakistan)` 15/25/35/20 = 95 d —
    // the §5.7 recommendation for a 75–85 d rice-fallow relay crop — and the Kc triple is the §5.7
    // "Green gram with Kc = 0.40 / 1.15 / 0.35", p = 0.45.
    stage_days: { ini: 15, dev: 25, mid: 35, late: 20 },
    max_height_m: 0.4,
    root_depth_m: { min: 0.6, max: 0.9 },
    depletion_p: 0.45,
    source:
      `Black gram (Urad) is NOT FOUND in FAO-56. Proxy: Tab. 11 ${TAB_11} row "Beans (dry) (Pakistan)" ` +
      `and Tab. 12 ${TAB_12} dry-pulse Kc, per docs/research/fao56-crop-tables.md §5.7; Tab. 22 ${TAB_22}.`,
  },
  redgram: {
    crop: "redgram",
    kc_ini: 0.4,
    kc_mid: 1.05,
    kc_end: 0.35,
    // ASSUMED: red gram / pigeonpea (Cajanus cajan, arhar) is **NOT FOUND** anywhere in FAO-56 —
    // it appears in neither the master crop table nor the §5 narrative. We take the closest
    // documented dry-pulse rows: stage lengths and Kc from the `Green gram, cowpeas` row of Tab. 11 /
    // Tab. 12 (the other Vigna pulse, same growth habit and the same AP rice-fallow system), and
    // Zr / p from Tab. 22 as §5.7 specifies for green gram. This knowingly understates red gram's
    // real duration (~150–180 d) and root depth; a locally sourced ANGRAU row should replace it
    // before red gram is used for canal-level commitments. Do not treat the season total for this
    // crop as authoritative.
    stage_days: { ini: 20, dev: 30, mid: 30, late: 20 },
    max_height_m: 0.4,
    root_depth_m: { min: 0.6, max: 1.0 },
    depletion_p: 0.45,
    source:
      `Red gram (Pigeonpea / arhar) is NOT FOUND in FAO-56. ASSUMED proxy: Tab. 11 ${TAB_11} row ` +
      `"Green gram, cowpeas" and Tab. 12 ${TAB_12} dry-pulse Kc, per docs/research/fao56-crop-tables.md ` +
      `§5.7; Tab. 22 ${TAB_22}. Not an FAO-56 value — replace with an AP red gram row before use.`,
  },
  chickpea: {
    crop: "chickpea",
    kc_ini: 0.4,
    kc_mid: 1.0,
    kc_end: 0.35,
    // ASSUMED: chickpea is present in Tab. 12 (Kc) and Tab. 22 (Zr, p) but **NOT FOUND** in
    // Tab. 11 (§2.1 and §5.7 both say so). Stage lengths are the §5.7 instruction to adopt them from
    // `Beans, dry` — 20/30/40/20 = 110 d — matching winter chickpea in Kurnool/Prakasam.
    stage_days: { ini: 20, dev: 30, mid: 40, late: 20 },
    max_height_m: 0.4,
    root_depth_m: { min: 0.6, max: 1.0 },
    depletion_p: 0.5,
    source:
      `Chickpea (Bengal gram). Kc: Tab. 12 ${TAB_12}; Zr, p: Tab. 22 ${TAB_22}. ` +
      `Stage lengths NOT FOUND in Tab. 11 — ASSUMED from the Tab. 11 "Beans, dry" row ` +
      `(${TAB_11}) per docs/research/fao56-crop-tables.md §5.7.`,
  },
};

/** The intermediate rice row: Rabi medium-duration paddy (Table 11's 30/30/60/30 = 150 d row, §5.1). */
export const RICE_INTERMITTENT_PARAMS: CropParams = {
  crop: "rice",
  variant: "intermittent",
  kc_ini: 1.05,
  kc_mid: 1.2,
  kc_end: 0.75,
  // Table 11 `Rice | 30 | 30 | 60 | 30 | 150 | Dec; May | Tropics; Mediterranean` (§5.1 case 2).
  // The shorter cycle is the one paired with AWD / intermittent irrigation: the crop matures sooner
  // and the field is drained between cycles, so less water is lost to continuous-flooding percolation.
  stage_days: { ini: 30, dev: 30, mid: 60, late: 30 },
  max_height_m: 1.0,
  root_depth_m: { min: 0.5, max: 1.0 },
  depletion_p: 0.2,
  percolation_mm_day: PARC_PERCOLATION_MM_DAY.intermittent,
  source:
    `Rice (Paddy) — Rabi / Medium-duration, paired with intermittent (AWD) water management. ` +
    `Tab. 11 ${TAB_11}; Tab. 12 ${TAB_12}; Tab. 14 ${TAB_14}; Tab. 22 ${TAB_22}. ` +
    `Transcribed from docs/research/fao56-crop-tables.md §2.1 and §5.1.`,
};

/**
 * Resolve the parameter row a plan should be evaluated with. Rice is the only crop with two rows;
 * `CropPlan.rice_practice` picks between them, defaulting to `flooded` when the field has not
 * declared a practice (a paddy with no declared practice is managed continuously flooded).
 */
export function cropParamsFor(plan: CropPlan): CropParams {
  if (plan.crop !== "rice") return CROP_PARAMS[plan.crop];
  if (plan.rice_practice === "intermittent") return RICE_INTERMITTENT_PARAMS;
  return { ...CROP_PARAMS.rice, variant: RICE_PRACTICE };
}

/** `L_total = L_ini + L_dev + L_mid + L_late` (FAO-56 Eq. 66, docs §4.3). */
export function seasonLengthDays(params: CropParams): number {
  const s = params.stage_days;
  return s.ini + s.dev + s.mid + s.late;
}

/** Cumulative day index at which each stage ends: `[L_ini, L_ini+L_dev, +L_mid, +L_late]` (Eq. 66). */
export function stageEndDays(params: CropParams): { ini: number; dev: number; mid: number; late: number } {
  const s = params.stage_days;
  const ini = s.ini;
  const dev = ini + s.dev;
  const mid = dev + s.mid;
  const late = mid + s.late;
  return { ini, dev, mid, late };
}

/**
 * Effective rooting depth on a given day (FAO-56 §4.5.1, and §2.5 of `fao56-model.md`):
 *   `Zr(t) = Zr_min + (Zr_max − Zr_min)·t / (L_ini + L_dev)` for `t ≤ L_ini + L_dev`, `Zr_max` after.
 * Days at or before sowing sit at `Zr_min`.
 */
export function rootingDepthAtDay(params: CropParams, daysAfterSowing: number): number {
  const { min, max } = params.root_depth_m;
  if (!Number.isFinite(daysAfterSowing) || daysAfterSowing <= 0) return min;
  const spread = stageEndDays(params).dev;
  if (spread <= 0) return max;
  if (daysAfterSowing >= spread) return max;
  return min + (max - min) * (daysAfterSowing / spread);
}

/** Climate inputs for the FAO-56 Kc adjustments (Eq. 62 / Eq. 65). */
export interface ClimateAdjustInput {
  /** Tabulated Kc_mid from FAO-56 Table 12. */
  kc_mid_tab: number;
  /** Tabulated Kc_end from FAO-56 Table 12. */
  kc_end_tab: number;
  /** Maximum crop height h, metres (Table 12). */
  height_m: number;
  /** Wind speed at 2 m, u₂, m s⁻¹. Table 12 values assume 2.0. */
  wind_u2_ms: number;
  /** Minimum relative humidity, RH_min, %. Table 12 values assume 45. */
  rh_min_pct: number;
}

/** FAO-56 validity window for Eq. 62 / Eq. 65 (docs/research/fao56-crop-tables.md §4.2). */
const KC_ADJUST_VALID = { wind: [1, 6] as const, rh: [20, 80] as const, height: [0.1, 10] as const };

/**
 * The height used in the `(h/3)^0.3` scaling factor. `fao56-model.md` §2.2 caps it at 3 m (so a
 * 3 m sugarcane canopy and a 4 m one get the same factor); §4.2.1 of the verified doc states the
 * wider validity window 0.1–10 m. Both are honoured: 3 m cap inside a 0.1–10 m validity window.
 */
const KC_ADJUST_HEIGHT_CAP_M = 3;

/**
 * Climatic adjustment of `Kc_mid` (FAO-56 Eq. 62) and `Kc_end` (Eq. 65), plus the Eq. 65 governing
 * rule: the end-stage adjustment applies **only** when `Kc_end(Tab) > 0.45`. In this table that
 * admits maize (0.48), cotton (0.60), groundnut (0.60), chilli (0.90), rice (0.75) and sugarcane
 * (0.75), and excludes the three pulses that finish at 0.35 — for a crop harvested dry the falling
 * Kc_end is a real canopy signal, not a climate artefact, so FAO-56 leaves it alone
 * (docs/research/fao56-crop-tables.md §4.2.2).
 *
 *   delta = [ 0.04·(u₂ − 2) − 0.004·(RH_min − 45) ] · (min(h,3)/3)^0.3
 *
 * Outside the validity window of Eq. 62 the tabulated values are returned unchanged; the equation is
 * not extrapolated. Pure: same input, same output.
 */
export function adjustKcForClimate(input: ClimateAdjustInput): { kc_mid: number; kc_end: number } {
  const { kc_mid_tab, kc_end_tab, height_m, wind_u2_ms, rh_min_pct } = input;
  const inWindow =
    Number.isFinite(height_m) &&
    Number.isFinite(wind_u2_ms) &&
    Number.isFinite(rh_min_pct) &&
    wind_u2_ms >= KC_ADJUST_VALID.wind[0] &&
    wind_u2_ms <= KC_ADJUST_VALID.wind[1] &&
    rh_min_pct >= KC_ADJUST_VALID.rh[0] &&
    rh_min_pct <= KC_ADJUST_VALID.rh[1] &&
    height_m >= KC_ADJUST_VALID.height[0] &&
    height_m <= KC_ADJUST_VALID.height[1];
  if (!inWindow) return { kc_mid: kc_mid_tab, kc_end: kc_end_tab };

  const h = Math.min(height_m, KC_ADJUST_HEIGHT_CAP_M);
  const delta =
    (0.04 * (wind_u2_ms - 2) - 0.004 * (rh_min_pct - 45)) * (h / 3) ** 0.3;
  return {
    kc_mid: kc_mid_tab + delta,
    kc_end: kc_end_tab > 0.45 ? kc_end_tab + delta : kc_end_tab,
  };
}