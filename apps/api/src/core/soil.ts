/**
 * Soil water storage — FAO-56 Table 19 (docs/research/fao56-crop-tables.md §3) plus the TAW / RAW
 * relations of §4.5.
 *
 * Convention, stated once here and applied throughout: **where Table 19 publishes a range we take
 * the midpoint.** FAO-56 gives hydraulic constants as ranges because a texture class spans soil
 * series; canal scheduling needs one number per texture, and the midpoint is the value that
 * minimises the worst-case bias. Every derived number in the API is traceable back to the published
 * range and the choice of midpoint.
 *
 * The seven `SoilType` members of the contract map onto Table 19 as:
 *
 *   sand         → Sand
 *   loamy_sand   → Loamy sand
 *   sandy_loam   → Sandy loam
 *   loam         → Loam
 *   silt_loam    → Silt loam
 *   clay_loam    → Silt clay loam   (the USDA texture matching "clay loam")
 *   clay         → Clay
 *
 * Table 19's two remaining rows (Silt, Silty clay) have no counterpart in the contract's enum and
 * are not carried.
 */

import type { SoilType } from "@jadal/contracts";

/** FAO-56 Table 19 chapter URL, cited by every table in this module. */
const TAB_19 =
  "https://www.fao.org/3/x0490e/x0490e0c.htm#soil evaporation reduction coefficient (kr)";

/** Midpoint of a published `lo–hi` range. */
export function midpoint(lo: number, hi: number): number {
  return (lo + hi) / 2;
}

/**
 * Table 19 as published, before the midpoint convention is applied. Kept as data so the report and
 * the tests can show the arithmetic: `{ range: [lo, hi], midpoint }` per texture.
 */
interface TextureRange {
  readonly range: readonly [number, number];
  readonly midpoint: number;
}

interface SoilRow {
  /** Published TAW range, mm of available water per metre of root zone, Table 19 col. 6. */
  readonly taw: TextureRange;
  /** Published REW range, mm, Table 19 col. 7. */
  readonly rew: TextureRange;
  /** Published TEW range, mm, at surface evaporation depth Ze = 0.10 m, Table 19 col. 8. */
  readonly tew: TextureRange;
}

/** θ_FC range, m³ m⁻³, Table 19 col. 3 — reported for traceability, see `THETA_FC` note below. */
const THETA_FC: Record<SoilType, TextureRange> = {
  sand: { range: [0.07, 0.17], midpoint: midpoint(0.07, 0.17) },
  loamy_sand: { range: [0.11, 0.19], midpoint: midpoint(0.11, 0.19) },
  sandy_loam: { range: [0.18, 0.28], midpoint: midpoint(0.18, 0.28) },
  loam: { range: [0.2, 0.3], midpoint: midpoint(0.2, 0.3) },
  silt_loam: { range: [0.22, 0.36], midpoint: midpoint(0.22, 0.36) },
  clay_loam: { range: [0.3, 0.37], midpoint: midpoint(0.3, 0.37) },
  clay: { range: [0.32, 0.4], midpoint: midpoint(0.32, 0.4) },
};

/** θ_WP range, m³ m⁻³, Table 19 col. 4 — reported for traceability. */
const THETA_WP: Record<SoilType, TextureRange> = {
  sand: { range: [0.02, 0.07], midpoint: midpoint(0.02, 0.07) },
  loamy_sand: { range: [0.03, 0.1], midpoint: midpoint(0.03, 0.1) },
  sandy_loam: { range: [0.06, 0.16], midpoint: midpoint(0.06, 0.16) },
  loam: { range: [0.07, 0.17], midpoint: midpoint(0.07, 0.17) },
  silt_loam: { range: [0.09, 0.21], midpoint: midpoint(0.09, 0.21) },
  clay_loam: { range: [0.17, 0.24], midpoint: midpoint(0.17, 0.24) },
  clay: { range: [0.2, 0.24], midpoint: midpoint(0.2, 0.24) },
};

const ROWS: Record<SoilType, SoilRow> = {
  sand: { taw: { range: [50, 110], midpoint: midpoint(50, 110) }, rew: { range: [2, 7], midpoint: midpoint(2, 7) }, tew: { range: [6, 12], midpoint: midpoint(6, 12) } },
  loamy_sand: { taw: { range: [60, 120], midpoint: midpoint(60, 120) }, rew: { range: [4, 8], midpoint: midpoint(4, 8) }, tew: { range: [9, 14], midpoint: midpoint(9, 14) } },
  sandy_loam: { taw: { range: [110, 150], midpoint: midpoint(110, 150) }, rew: { range: [6, 10], midpoint: midpoint(6, 10) }, tew: { range: [15, 20], midpoint: midpoint(15, 20) } },
  loam: { taw: { range: [130, 180], midpoint: midpoint(130, 180) }, rew: { range: [8, 10], midpoint: midpoint(8, 10) }, tew: { range: [16, 22], midpoint: midpoint(16, 22) } },
  silt_loam: { taw: { range: [130, 190], midpoint: midpoint(130, 190) }, rew: { range: [8, 11], midpoint: midpoint(8, 11) }, tew: { range: [18, 25], midpoint: midpoint(18, 25) } },
  clay_loam: { taw: { range: [130, 180], midpoint: midpoint(130, 180) }, rew: { range: [8, 11], midpoint: midpoint(8, 11) }, tew: { range: [22, 27], midpoint: midpoint(22, 27) } },
  clay: { taw: { range: [120, 200], midpoint: midpoint(120, 200) }, rew: { range: [8, 12], midpoint: midpoint(8, 12) }, tew: { range: [22, 29], midpoint: midpoint(22, 29) } },
};

/**
 * Total available water per metre of root zone, mm m⁻¹ (Table 19 col. 6, midpoints).
 * This column — not a recomputation from the θ midpoints — is the authoritative available-water
 * figure: FAO-56 prints it directly and it absorbs the rounding in the θ columns. Recomputing
 * `1000·(θ_FC − θ_WP)` from the θ midpoints drifts by up to 5 mm m⁻¹ (e.g. sand: 1000·(0.12 −
 * 0.045) = 75 against a published midpoint of 80) because the θ ranges are given to 0.01 only.
 */
export const TAW_MM_PER_M: Record<SoilType, number> = {
  sand: ROWS.sand.taw.midpoint,
  loamy_sand: ROWS.loamy_sand.taw.midpoint,
  sandy_loam: ROWS.sandy_loam.taw.midpoint,
  loam: ROWS.loam.taw.midpoint,
  silt_loam: ROWS.silt_loam.taw.midpoint,
  clay_loam: ROWS.clay_loam.taw.midpoint,
  clay: ROWS.clay.taw.midpoint,
};

/** Readily evaporable water, mm (Table 19 col. 7, midpoints). */
export const REW_MM: Record<SoilType, number> = {
  sand: ROWS.sand.rew.midpoint,
  loamy_sand: ROWS.loamy_sand.rew.midpoint,
  sandy_loam: ROWS.sandy_loam.rew.midpoint,
  loam: ROWS.loam.rew.midpoint,
  silt_loam: ROWS.silt_loam.rew.midpoint,
  clay_loam: ROWS.clay_loam.rew.midpoint,
  clay: ROWS.clay.rew.midpoint,
};

/** Total evaporable water, mm, at Ze = 0.10 m (Table 19 col. 8, midpoints). */
export const TEW_MM: Record<SoilType, number> = {
  sand: ROWS.sand.tew.midpoint,
  loamy_sand: ROWS.loamy_sand.tew.midpoint,
  sandy_loam: ROWS.sandy_loam.tew.midpoint,
  loam: ROWS.loam.tew.midpoint,
  silt_loam: ROWS.silt_loam.tew.midpoint,
  clay_loam: ROWS.clay_loam.tew.midpoint,
  clay: ROWS.clay.tew.midpoint,
};

/** Field-capacity water content, m³ m⁻³ (Table 19 col. 3, midpoints) — reporting only. */
export const THETA_FC_BY_SOIL: Record<SoilType, number> = {
  sand: THETA_FC.sand.midpoint,
  loamy_sand: THETA_FC.loamy_sand.midpoint,
  sandy_loam: THETA_FC.sandy_loam.midpoint,
  loam: THETA_FC.loam.midpoint,
  silt_loam: THETA_FC.silt_loam.midpoint,
  clay_loam: THETA_FC.clay_loam.midpoint,
  clay: THETA_FC.clay.midpoint,
};

/** Permanent wilting-point water content, m³ m⁻³ (Table 19 col. 4, midpoints) — reporting only. */
export const THETA_WP_BY_SOIL: Record<SoilType, number> = {
  sand: THETA_WP.sand.midpoint,
  loamy_sand: THETA_WP.loamy_sand.midpoint,
  sandy_loam: THETA_WP.sandy_loam.midpoint,
  loam: THETA_WP.loam.midpoint,
  silt_loam: THETA_WP.silt_loam.midpoint,
  clay_loam: THETA_WP.clay_loam.midpoint,
  clay: THETA_WP.clay.midpoint,
};

/** The published ranges, exported so a report or test can show "80 = midpoint of 50–110". */
export const SOIL_RANGES: Record<SoilType, { taw_mm_per_m: readonly [number, number]; rew_mm: readonly [number, number]; tew_mm: readonly [number, number] }> = {
  sand: { taw_mm_per_m: ROWS.sand.taw.range, rew_mm: ROWS.sand.rew.range, tew_mm: ROWS.sand.tew.range },
  loamy_sand: { taw_mm_per_m: ROWS.loamy_sand.taw.range, rew_mm: ROWS.loamy_sand.rew.range, tew_mm: ROWS.loamy_sand.tew.range },
  sandy_loam: { taw_mm_per_m: ROWS.sandy_loam.taw.range, rew_mm: ROWS.sandy_loam.rew.range, tew_mm: ROWS.sandy_loam.tew.range },
  loam: { taw_mm_per_m: ROWS.loam.taw.range, rew_mm: ROWS.loam.rew.range, tew_mm: ROWS.loam.tew.range },
  silt_loam: { taw_mm_per_m: ROWS.silt_loam.taw.range, rew_mm: ROWS.silt_loam.rew.range, tew_mm: ROWS.silt_loam.tew.range },
  clay_loam: { taw_mm_per_m: ROWS.clay_loam.taw.range, rew_mm: ROWS.clay_loam.rew.range, tew_mm: ROWS.clay_loam.tew.range },
  clay: { taw_mm_per_m: ROWS.clay.taw.range, rew_mm: ROWS.clay.rew.range, tew_mm: ROWS.clay.tew.range },
};

/** Provenance of the tables above, for API responses and report footnotes. */
export const SOIL_TABLE_SOURCE = `FAO-56 Table 19 (typical soil water characteristics), ${TAB_19}, midpoints of published ranges, per docs/research/fao56-crop-tables.md §3.`;

/**
 * Total available water in the root zone, mm (FAO-56 Eq. 82, §4.5.1):
 *   `TAW = TAW_unit · Z_r`, where `TAW_unit` is Table 19 col. 6 in mm m⁻¹ and `Z_r` in metres.
 * Equivalent to `1000·(θ_FC − θ_WP)·Z_r` with the Table 19 available-water column substituted for
 * the θ difference (see `TAW_MM_PER_M`).
 */
export function soilAvailableWater_mm(soil: SoilType, rootDepth_m: number): number {
  if (!Number.isFinite(rootDepth_m) || rootDepth_m < 0) {
    throw new RangeError(`rootDepth_m must be a non-negative finite number, got ${String(rootDepth_m)}`);
  }
  return TAW_MM_PER_M[soil] * rootDepth_m;
}

/** Readily available water, mm (FAO-56 §4.5.2): `RAW = p · TAW`. */
export function readilyAvailableWater(p: number, taw_mm: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`depletion fraction p must lie in [0, 1], got ${String(p)}`);
  }
  if (!Number.isFinite(taw_mm) || taw_mm < 0) {
    throw new RangeError(`taw_mm must be a non-negative finite number, got ${String(taw_mm)}`);
  }
  return p * taw_mm;
}

/** The physical bounds FAO-56 imposes on the depletion fraction (§4.5.3). */
export const P_MIN = 0.1;
export const P_MAX = 0.8;

export function clampP(p: number): number {
  return Math.min(P_MAX, Math.max(P_MIN, p));
}

/**
 * ASSUMED: soil-texture multiplier on the depletion fraction. FAO-56 §4.5.3 states only the
 * direction and a range — "for fine-textured soils (heavy clay Vertisols), reduce p by 5–10 %; for
 * coarse sandy soils, increase p by 5–10 %" — it does not assign a value per USDA texture class, and
 * the phrase "heavy clay Vertisols" is a soil order, not the `SoilType` enum we schedule against.
 * We take the midpoint of each published range (0.925 and 1.075) and apply it to the two clearly
 * coarse classes (sand, loamy sand) and the two clearly fine ones (clay loam, clay). Sandy loam,
 * loam and silt loam are intermediate textures and get no modifier. Field trials would replace this.
 */
export function textureDepletionFactor(soil: SoilType): number {
  if (soil === "clay_loam" || soil === "clay") return 0.925;
  if (soil === "sand" || soil === "loamy_sand") return 1.075;
  return 1;
}

/**
 * Depletion fraction adjusted for atmospheric demand (FAO-56 §4.5.3), then for soil texture:
 *
 *   `p = clamp(p_table + 0.04·(5 − ETc), 0.10, 0.80)`
 *
 * High evaporative demand exhausts the crop's soil water reserve faster, so stress begins at a
 * smaller depletion and `p` shrinks; low demand lets `p` grow. The clamp is the published physical
 * bound. The texture multiplier is applied afterwards and the result is clamped again, because a
 * coarse-soil bonus must not push `p` past the 0.80 FAO-56 ceiling.
 */
export function dynamicDepletionFraction(input: {
  /** Tabulated p from FAO-56 Table 22 (i.e. `CropParams.depletion_p`), valid at ETc ≈ 5 mm d⁻¹. */
  p_table: number;
  /** Mean daily crop evapotranspiration over the interval, mm d⁻¹ (ETc = Kc·ET₀, Eq. 58). */
  etc_mm_day: number;
  /** Soil texture; omit to skip the texture modifier. */
  soil?: SoilType;
}): number {
  const { p_table, etc_mm_day, soil } = input;
  if (!Number.isFinite(p_table) || p_table <= 0 || p_table > 1) {
    throw new RangeError(`p_table must lie in (0, 1], got ${String(p_table)}`);
  }
  const demandTerm = Number.isFinite(etc_mm_day) ? 0.04 * (5 - etc_mm_day) : 0;
  const adjusted = clampP(p_table + demandTerm);
  if (soil === undefined) return adjusted;
  return clampP(adjusted * textureDepletionFactor(soil));
}

/**
 * Water-stress coefficient `Ks` (FAO-56 §4.6, Eq. 84): 1 above RAW, falling linearly to 0 at TAW.
 * Used by the roster and need agents to report stress risk; the crop engine itself reports demand
 * under standard (unstressed) conditions.
 */
export function waterStressCoefficient(depletion_mm: number, raw_mm: number, taw_mm: number): number {
  if (!Number.isFinite(depletion_mm) || !Number.isFinite(raw_mm) || !Number.isFinite(taw_mm)) return 0;
  if (taw_mm <= 0) return 0;
  if (depletion_mm <= raw_mm) return 1;
  if (depletion_mm >= taw_mm) return 0;
  const denom = taw_mm - raw_mm;
  if (denom <= 0) return 0;
  return (taw_mm - depletion_mm) / denom;
}