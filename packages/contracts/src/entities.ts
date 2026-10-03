import { z } from "zod";

// Naming convention boundary. Entity field names are snake_case because they are the wire/DB
// vocabulary: each key here maps 1:1 to a projection column (see apps/api/src/db/schema.sql.ts) and
// is what `JSON.stringify` puts on the HTTP response. TypeScript-only identifiers — schema names,
// type aliases, functions, locals — are camelCase (`CropPlan`, `cropEngine`, `weekStart`). Never
// camelCase a contract field to "look JS-y": the row mapper and the API client both read the
// snake_case key, so renaming it silently drops the value.
//
// Units are encoded in field names: _m3 (cubic metres), _m3s (m³/s), _m (metres), _ha (hectares),
// _mm (millimetres of water depth), _h (hours). Timestamps are ISO-8601 strings in UTC.

export const Id = z.string().min(1);
export const IsoTime = z.string().datetime();
export const IsoDate = z.string().date();

export const Language = z.enum(["te", "en", "hi"]);
export const Channel = z.enum(["voice", "whatsapp", "sms", "portal"]);

export const CropName = z.enum([
  "rice",
  "maize",
  "groundnut",
  "cotton",
  "chilli",
  "sugarcane",
  "greengram",
  "blackgram",
  "redgram",
  "chickpea",
]);
export type CropName = z.infer<typeof CropName>;

export const SoilType = z.enum(["sand", "loamy_sand", "sandy_loam", "loam", "silt_loam", "clay_loam", "clay"]);
export type SoilType = z.infer<typeof SoilType>;

export const Canal = z.object({
  id: Id,
  name: z.string(),
  length_m: z.number().positive(),
  head_discharge_m3s: z.number().positive(),
  /** Exponential seepage decay per metre: Q(x) = Q0 · e^(−k·x). ASSUMED default 1.2e-4 for unlined earthen canal. */
  seepage_k_per_m: z.number().nonnegative(),
  manning_n: z.number().positive(),
  bed_slope: z.number().positive(),
  /** Hydraulic radius used for Manning velocity, metres. */
  hydraulic_radius_m: z.number().positive(),
  lined: z.boolean(),
});
export type Canal = z.infer<typeof Canal>;

export const Outlet = z.object({
  id: Id,
  canal_id: Id,
  name: z.string(),
  /** Distance from canal head, metres. */
  chainage_m: z.number().nonnegative(),
});
export type Outlet = z.infer<typeof Outlet>;

export const Farmer = z.object({
  id: Id,
  name: z.string(),
  phone: z.string(),
  language: Language,
  preferred_channels: z.array(Channel).min(1),
  has_smartphone: z.boolean(),
  /** Used to pick the Telugu honorific; omitted means the caller falls back to a neutral form. */
  gender: z.enum(["male", "female", "other"]).optional(),
});
export type Farmer = z.infer<typeof Farmer>;

export const Plot = z.object({
  id: Id,
  farmer_id: Id,
  outlet_id: Id,
  area_ha: z.number().positive(),
  soil: SoilType,
  lat: z.number(),
  lon: z.number(),
});
export type Plot = z.infer<typeof Plot>;

export const CropPlanStatus = z.enum(["registered", "verified", "active", "harvested"]);

export const CropPlan = z.object({
  id: Id,
  plot_id: Id,
  crop: CropName,
  sowing_date: IsoDate,
  /** Fraction of the plot under this crop (a farmer may split a plot between crops). */
  area_fraction: z.number().gt(0).lte(1),
  /** Application efficiency Ea (0–1). Default by method: basin 0.80, furrow 0.65 (ASSUMED project defaults). */
  application_efficiency: z.number().gt(0).lte(1),
  /** Rice only: water management practice (FAO-56 2025 Table 6.2 distinguishes flooded vs intermittent irrigation). */
  rice_practice: z.enum(["flooded", "intermittent"]).optional(),
  status: CropPlanStatus,
});
export type CropPlan = z.infer<typeof CropPlan>;

/** FAO-56 crop parameters. Loaded from the verified table; never typed in by hand in feature code. */
export const CropParams = z.object({
  crop: CropName,
  /** e.g. "flooded" / "intermittent" for rice; omitted for crops with a single row. */
  variant: z.string().optional(),
  kc_ini: z.number(),
  kc_mid: z.number(),
  kc_end: z.number(),
  /** Calendar stage lengths (days) used by the engine. FAO-56 2025 converts thermal (GDD) lengths to days (p. 213–214). */
  stage_days: z.object({ ini: z.number(), dev: z.number(), mid: z.number(), late: z.number() }),
  /** Optional thermal stage lengths, FAO-56 2025 Tables 6.10–6.12. */
  stage_gdd: z.object({ ini: z.number(), dev: z.number(), mid: z.number(), late: z.number() }).optional(),
  t_base_c: z.number().optional(),
  t_upper_c: z.number().optional(),
  max_height_m: z.number(),
  root_depth_m: z.object({ min: z.number(), max: z.number() }),
  depletion_p: z.number(),
  /** Paddy only: percolation through the puddled layer, mm/day. */
  percolation_mm_day: z.number().optional(),
  source: z.string(),
});
export type CropParams = z.infer<typeof CropParams>;

export const WeatherDay = z.object({
  date: IsoDate,
  et0_mm: z.number().nonnegative(),
  rain_mm: z.number().nonnegative(),
  tmax_c: z.number().optional(),
  tmin_c: z.number().optional(),
  /** Minimum relative humidity, percent. Optional: older records only carry temperature. */
  rh_min: z.number().optional(),
  /** Wind speed at 2 m, metres per second. Optional for the same reason. */
  wind_ms: z.number().optional(),
});
export type WeatherDay = z.infer<typeof WeatherDay>;

export const ReleaseWindow = z.object({
  id: Id,
  canal_id: Id,
  start: IsoTime,
  end: IsoTime,
  discharge_m3s: z.number().positive(),
});
export type ReleaseWindow = z.infer<typeof ReleaseWindow>;

export const EntitlementStatus = z.enum(["proposed", "approved", "edited"]);

/** Weekly volume entitlement at the field gate for one crop plan. */
export const Entitlement = z.object({
  id: Id,
  farmer_id: Id,
  crop_plan_id: Id,
  week_start: IsoDate,
  volume_m3: z.number().nonnegative(),
  net_irrigation_mm: z.number().nonnegative(),
  status: EntitlementStatus,
  explanation: z.string().optional(),
});
export type Entitlement = z.infer<typeof Entitlement>;

export const Turn = z.object({
  id: Id,
  roster_id: Id,
  outlet_id: Id,
  farmer_id: Id,
  start: IsoTime,
  end: IsoTime,
  planned_volume_m3: z.number().nonnegative(),
  expected_flow_m3s: z.number().nonnegative(),
  lag_h: z.number().nonnegative(),
});
export type Turn = z.infer<typeof Turn>;

export const RosterStatus = z.enum(["proposed", "approved", "superseded"]);

export const Roster = z.object({
  id: Id,
  canal_id: Id,
  release_window_id: Id,
  status: RosterStatus,
  /** Scheduling rule the roster was built with; omitted means the default equal_water. */
  mode: z.enum(["equal_water", "equal_hours"]).optional(),
  turns: z.array(Turn),
  /** Volume that could not be scheduled inside the window, by farmer. */
  shortfall_m3: z.record(Id, z.number()),
});
export type Roster = z.infer<typeof Roster>;

export const RequestType = z.enum(["urgent", "buffer", "release_to_buffer", "harvest_exit"]);
export const RequestStatus = z.enum([
  "raised",
  "triaged",
  "recommended",
  "approved",
  "rejected",
  "scheduled",
  "released",
  "delivered",
  "confirmed",
  "cancelled",
  "expired",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const WaterRequest = z.object({
  id: Id,
  farmer_id: Id,
  crop_plan_id: Id.optional(),
  type: RequestType,
  volume_m3: z.number().nonnegative(),
  reason: z.string(),
  channel: Channel,
  status: RequestStatus,
  raised_at: IsoTime,
  /** System-1 urgency score 0–1 (Jev/Laya). */
  triage_score: z.number().min(0).max(1).optional(),
  agent_recommendation: z
    .object({ decision: z.enum(["approve", "reject", "partial"]), volume_m3: z.number(), rationale: z.string() })
    .optional(),
  coordinator_decision: z
    .object({ decision: z.enum(["approve", "reject"]), volume_m3: z.number(), note: z.string().optional(), at: IsoTime })
    .optional(),
});
export type WaterRequest = z.infer<typeof WaterRequest>;

export const LedgerAccount = z.union([
  z.literal("canal_supply"),
  z.literal("buffer"),
  z.literal("losses:conveyance"),
  z.string().regex(/^farmer:[^:]+:(quota|delivered)$/),
]);
export type LedgerAccount = z.infer<typeof LedgerAccount>;

/** One double-entry movement. Every event that moves water writes one or more of these atomically. */
export const LedgerEntry = z.object({
  id: Id,
  at: IsoTime,
  from: LedgerAccount,
  to: LedgerAccount,
  volume_m3: z.number().positive(),
  reason: z.string(),
  event_id: Id,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const ContactStatus = z.enum(["queued", "sent", "delivered", "acknowledged", "failed", "escalated"]);

/** Why a contact was made. Shared with the `place_call` tool so both agree on the vocabulary. */
export const ContactPurpose = z.enum(["roster_change", "release_warning", "request_update", "reminder"]);
export type ContactPurpose = z.infer<typeof ContactPurpose>;

export const Contact = z.object({
  id: Id,
  farmer_id: Id,
  channel: Channel,
  purpose: ContactPurpose,
  status: ContactStatus,
  attempt: z.number().int().positive(),
  message_te: z.string(),
  message_en: z.string(),
  at: IsoTime,
  transcript: z.string().optional(),
  /** True when no real telephony call was placed (demo/mock); the UI must not imply a real send. */
  simulated: z.boolean().optional(),
  /** Twilio CallSid when a real call was placed. */
  call_sid: z.string().optional(),
});
export type Contact = z.infer<typeof Contact>;
