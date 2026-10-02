# ADR-climate-weatherday: add optional RHmin and wind to `WeatherDay` so the FAO-56 Kc climate adjustment can fire

Status: **proposed — needs `contracts-ok`; NOT applied.** Owner: orchestrator / contracts reviewer.
Code touched by this ADR: **none**. The change is staged as an unapplied patch at
`docs/decisions/patches/weatherday-additive.patch`. Handoff item: **P7**.

## Context

FAO-56 Table 6.2 tabulates Kc for a standardized sub-humid climate (RHmin ≈ 45 %, u2 ≈ 2 m/s).
Outside that climate the coefficients must be corrected by FAO-56 Eq. 6.18 (Kc mid) / Eq. 6.21
(Kc end). The deterministic core implements this as `adjustKcForClimate` in
`packages/core/src/crop.ts`, whose validity domain is `1 ≤ u2 ≤ 6 m/s`, `20 ≤ RHmin ≤ 80 %`,
`0.1 ≤ h ≤ 10 m`; outside it the tabulated Kc is returned unchanged.

The correction is opt-in and **cannot fire in production today**: the contract type that carries
weather is

```ts
export const WeatherDay = z.object({
  date: IsoDate,
  et0_mm: z.number().nonnegative(),
  rain_mm: z.number().nonnegative(),
  tmax_c: z.number().optional(),
  tmin_c: z.number().optional(),
});
```

There is no humidity or wind field, and a grep of `apps/api/src` found no humidity/wind fetch
either (`RAN`: `grep -rn "relative_humidity|windspeed_10m|wind_speed|rh_min|wind_u2" apps/api/src`
→ no output). So every production `weeklyNeed` call runs on the tabulated Kc and the adjustment is
dead code. `packages/core/src/crop.ts` added optional `wind_u2_ms` / `rh_min_pct` arguments to keep
the correction reachable for callers that already have the data; the contract gap is what blocks it.

## Decision

**Add two optional, additive fields to `WeatherDay`** in `packages/contracts/src/entities.ts`:

| Field | Type | Meaning |
|---|---|---|
| `rh_min_pct` | `z.number().min(0).max(100).optional()` | Mean minimum relative humidity for the day [%] — the `RHmin` input |
| `wind_u2_ms` | `z.number().nonnegative().optional()` | Mean wind speed at 2 m [m/s] — the `u2` input |

Properties of the change:

- **Additive and optional.** No existing object literal, producer, or consumer of `WeatherDay`
  changes meaning. Absent means "unknown", never "0 %"/"0 m/s". Zod parses existing weather JSON
  unchanged.
- **No default.** Defaulting a missing value would fabricate a climate and make the adjustment fire
  on unmeasured data — forbidden by the project's no-silent-numbers rule.
- **Exact patch:** `docs/decisions/patches/weatherday-additive.patch`, verified against the current
  tree with `git apply --check` (`RAN`, exit 0). It is **not applied**; `packages/contracts` is
  untouched (`RAN`: `git status --short packages/contracts` → empty).

## Core side is already ready

This work accompanied the ADR:

- `adjustCropParamsForClimate(params, climate)` in `packages/core/src/crop.ts` is the single place
  the correction is applied, and is a **strict no-op** (returns the same object reference) unless
  both climate inputs are supplied, finite, and in-domain. `cropEngine.weeklyNeed` now routes
  through it, so once the contract carries the fields a caller can pass them and the existing
  output is bit-for-bit unchanged otherwise.
- A fix landed alongside: `adjustKcForClimate` previously **clamped** `h` to `[0.1, 10]` despite its
  own doc comment and `docs/architecture/models.md` both saying out-of-range inputs return the
  tabulated Kc unchanged. It now no-ops for `h` outside `[0.1, 10]`, matching the documented
  contract. `RAN`: shipped `crop-params.json` `max_height_m` values are 0.5–3.0 m, all in range, so
  no shipped output changed; `models.audit.test.ts` (66 tests) and `crop.test.ts` (15 tests) pass.

## Consequences

- **Enables** the adjustment: providers must populate the two fields from real observations/forecast
  (e.g. an Open-Meteo `relative_humidity_2m_min` / `wind_speed_10m` request); only then will
  `weeklyNeed` receive them. Contract change is necessary but not sufficient — the weather fetch in
  `apps/api` is a follow-up.
- **Risk if a producer defaults to 0:** a false arid/calm reading. Mitigated by "optional, no
  default" above and by the core's domain gate.
- **`seasonNeed`** does not forward climate inputs today (its input type has no such fields). It
  calls `weeklyNeed` without them and therefore stays tabulated. Forwarding is a separate additive
  change; this ADR does not propose it to keep the patch minimal.
- **Rollback:** drop the two fields from the contract; no data migration, since nothing persists
  `WeatherDay` fields that would become unknown.

## Alternatives considered

1. **New `ClimateDay` type referenced by `WeatherDay`.** More types and a new nested schema for two
   numbers; rejected as heavier than the additive fields.
2. **Keep it core-only** (current opt-in args, no contract change). Leaves the adjustment dead in
   production, which is exactly the P7 defect; rejected.
3. **Derive RHmin/wind from existing `tmax_c`/`tmin_c`.** No defensible source for wind, and RHmin
   is not a function of temperature alone; would be an invented number; rejected.

## Required action

Apply `docs/decisions/patches/weatherday-additive.patch` only under the **`contracts-ok`** label,
then add the weather-provider fields in `apps/api`. Until then this ADR is a proposal and the patch
stays unapplied.
