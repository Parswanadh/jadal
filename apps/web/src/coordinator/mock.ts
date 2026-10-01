// Offline mock for the coordinator console.
// All volumes/flows are ASSUMED illustrative values consistent with
// packages/contracts/fixtures/demo-scenario.json (8 farms, Kondaveedu Minor).
// The live API (apps/api) replaces these numbers when reachable; the UI
// must never hard-code water maths outside this mock / the API responses.

export interface MockPlot {
  id: string;
  outletId: string;
  areaHa: number;
  soil: string;
}

export interface MockCropPlan {
  id: string;
  plotId: string;
  crop: string;
  sowingDate: string;
}

export interface FarmerRegistration {
  farmer: { id: string; name: string; phone: string; hasSmartphone: boolean; channels: string[] };
  plots: MockPlot[];
  cropPlans: MockCropPlan[];
  verified: boolean;
}

export interface EntitlementRow {
  id: string;
  farmerId: string;
  farmerName: string;
  cropPlanId: string;
  crop: string;
  weekStart: string;
  volumeM3: number;
  netMm: number;
  status: "proposed" | "approved" | "edited";
}

export interface TurnRow {
  id: string;
  outletId: string;
  farmerId: string;
  farmerName: string;
  start: string;
  end: string;
  plannedVolumeM3: number;
  expectedFlowM3s: number;
  durationH: number;
  needMetPct: number;
}

export interface RosterProposal {
  id: string;
  mode: "equal_water" | "equal_hours";
  releaseWindowId: string;
  turns: TurnRow[];
  equalHoursGini: number;
  equalWaterGini: number;
}

export interface RequestRow {
  id: string;
  farmerId: string;
  farmerName: string;
  type: "urgent" | "buffer" | "release_to_buffer" | "harvest_exit";
  volumeM3: number;
  reason: string;
  reasonTe: string;
  channel: string;
  status: string;
  triageScore: number;
  recommendation: { decision: "approve" | "reject" | "partial"; volumeM3: number; rationale: string; rationaleTe: string };
  decision?: { decision: "approve" | "reject"; volumeM3: number; note?: string };
}

export interface LedgerFarmer {
  farmerId: string;
  name: string;
  quotaM3: number;
  deliveredM3: number;
  needMetPct: number;
}

export interface LedgerEntryRow {
  id: string;
  at: string;
  from: string;
  to: string;
  volumeM3: number;
  reason: string;
}

export interface LedgerView {
  canalSupplyM3: number;
  bufferM3: number;
  conveyanceLossesM3: number;
  farmers: LedgerFarmer[];
  conservationOk: boolean;
  gini: number;
  entries: LedgerEntryRow[];
}

export interface AuditView {
  findings: { severity: "info" | "warn" | "critical"; text: string }[];
  summaryEn: string;
  summaryTe: string;
}

export const MOCK_WEEK = "2026-09-14";
export const MOCK_SEASON_TOTAL_M3 = 5530;
export const MOCK_EXPLANATION_EN =
  "FAO-56 crop need for week of 2026-09-14: ET0 5.8 mm/day from Open-Meteo, effective rain 2 mm deducted, " +
  "Kc by growth stage (rice flowering Kc 1.2, cotton boll Kc 1.1), root-zone balance capped by RAW. " +
  "Tail outlets keep full volume because seepage loss is compensated in turn duration, not in volume.";
export const MOCK_EXPLANATION_TE =
  "2026-09-14 వారం FAO-56 పంట అవసరం: ET0 రోజుకు 5.8 మిమీ, 2 మిమీ ప్రభావవంతమైన వర్షం తగ్గింపు, " +
  "దశల వారీ Kc (వరి పూత Kc 1.2, పత్తి కాయ Kc 1.1). చివరి అవుట్‌లెట్‌లకు పూర్తి ఘనపరిమాణం ఉంటుంది; " +
  "సీపేజ్ నష్టాన్ని సమయంలో సర్దుతారు, ఘనపరిమాణంలో కాదు.";

const REGISTRATIONS: FarmerRegistration[] = [
  {
    farmer: { id: "f1", name: "Ramaiah Kota", phone: "+919000000001", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p1", outletId: "o1", areaHa: 2.0, soil: "clay_loam" }],
    cropPlans: [{ id: "cp1", plotId: "p1", crop: "rice", sowingDate: "2026-07-10" }],
    verified: true,
  },
  {
    farmer: { id: "f2", name: "Lakshmi Devi Pasupuleti", phone: "+919000000002", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p2", outletId: "o2", areaHa: 1.2, soil: "clay_loam" }],
    cropPlans: [{ id: "cp2", plotId: "p2", crop: "rice", sowingDate: "2026-07-10" }],
    verified: true,
  },
  {
    farmer: { id: "f3", name: "Venkata Rao Gadde", phone: "+919000000003", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p3", outletId: "o3", areaHa: 3.0, soil: "clay" }],
    cropPlans: [{ id: "cp3", plotId: "p3", crop: "cotton", sowingDate: "2026-07-10" }],
    verified: true,
  },
  {
    farmer: { id: "f4", name: "Suresh Babu Nannapaneni", phone: "+919000000004", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p4", outletId: "o4", areaHa: 1.5, soil: "clay_loam" }],
    cropPlans: [
      { id: "cp4", plotId: "p4", crop: "chilli", sowingDate: "2026-07-10" },
      { id: "cp9", plotId: "p4", crop: "blackgram", sowingDate: "2026-08-01" },
    ],
    verified: true,
  },
  {
    farmer: { id: "f5", name: "Anjamma Bandi", phone: "+919000000005", hasSmartphone: false, channels: ["voice"] },
    plots: [{ id: "p5", outletId: "o5", areaHa: 0.6, soil: "sandy_loam" }],
    cropPlans: [{ id: "cp5", plotId: "p5", crop: "groundnut", sowingDate: "2026-08-01" }],
    verified: false,
  },
  {
    farmer: { id: "f6", name: "Srinivas Reddy Yeluri", phone: "+919000000006", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p6", outletId: "o6", areaHa: 2.5, soil: "loam" }],
    cropPlans: [{ id: "cp6", plotId: "p6", crop: "maize", sowingDate: "2026-07-10" }],
    verified: true,
  },
  {
    farmer: { id: "f7", name: "Padmavathi Kolli", phone: "+919000000007", hasSmartphone: true, channels: ["voice", "whatsapp"] },
    plots: [{ id: "p7", outletId: "o7", areaHa: 1.0, soil: "clay_loam" }],
    cropPlans: [{ id: "cp7", plotId: "p7", crop: "rice", sowingDate: "2026-07-10" }],
    verified: true,
  },
  {
    farmer: { id: "f8", name: "Narasimha Chinta", phone: "+919000000008", hasSmartphone: false, channels: ["voice"] },
    plots: [{ id: "p8", outletId: "o8", areaHa: 0.8, soil: "sandy_loam" }],
    cropPlans: [{ id: "cp8", plotId: "p8", crop: "greengram", sowingDate: "2026-08-01" }],
    verified: false,
  },
];

const ENTITLEMENTS: EntitlementRow[] = [
  { id: "e1", farmerId: "f1", farmerName: "Ramaiah Kota", cropPlanId: "cp1", crop: "rice", weekStart: MOCK_WEEK, volumeM3: 1050, netMm: 42, status: "proposed" },
  { id: "e2", farmerId: "f2", farmerName: "Lakshmi Devi Pasupuleti", cropPlanId: "cp2", crop: "rice", weekStart: MOCK_WEEK, volumeM3: 630, netMm: 42, status: "proposed" },
  { id: "e3", farmerId: "f3", farmerName: "Venkata Rao Gadde", cropPlanId: "cp3", crop: "cotton", weekStart: MOCK_WEEK, volumeM3: 1290, netMm: 28, status: "proposed" },
  { id: "e4", farmerId: "f4", farmerName: "Suresh Babu Nannapaneni", cropPlanId: "cp4", crop: "chilli", weekStart: MOCK_WEEK, volumeM3: 450, netMm: 26, status: "proposed" },
  { id: "e9", farmerId: "f4", farmerName: "Suresh Babu Nannapaneni", cropPlanId: "cp9", crop: "blackgram", weekStart: MOCK_WEEK, volumeM3: 135, netMm: 20, status: "proposed" },
  { id: "e5", farmerId: "f5", farmerName: "Anjamma Bandi", cropPlanId: "cp5", crop: "groundnut", weekStart: MOCK_WEEK, volumeM3: 210, netMm: 23, status: "proposed" },
  { id: "e6", farmerId: "f6", farmerName: "Srinivas Reddy Yeluri", cropPlanId: "cp6", crop: "maize", weekStart: MOCK_WEEK, volumeM3: 1000, netMm: 26, status: "proposed" },
  { id: "e7", farmerId: "f7", farmerName: "Padmavathi Kolli", cropPlanId: "cp7", crop: "rice", weekStart: MOCK_WEEK, volumeM3: 525, netMm: 42, status: "proposed" },
  { id: "e8", farmerId: "f8", farmerName: "Narasimha Chinta", cropPlanId: "cp8", crop: "greengram", weekStart: MOCK_WEEK, volumeM3: 240, netMm: 20, status: "proposed" },
];

// Flows at outlets for Q0=0.15 m3/s, k=1.2e-4 (demo canal). ASSUMED illustrative.
const FLOWS: Record<string, number> = {
  o1: 0.1447, o2: 0.1387, o3: 0.133, o4: 0.1268, o5: 0.1209, o6: 0.1152, o7: 0.1105, o8: 0.1059,
};

function turnTime(id: string, outletId: string, farmerId: string, farmerName: string, vol: number, needPct: number, startH: number): TurnRow {
  const flow = FLOWS[outletId] ?? 0.12;
  const durH = vol / flow / 3600;
  const start = `2026-09-15T${String(startH).padStart(2, "0")}:30:00Z`;
  const endH = startH + durH;
  const end = `2026-09-15T${String(Math.floor(endH)).padStart(2, "0")}:${String(Math.round((endH % 1) * 60)).padStart(2, "0")}:00Z`;
  return { id, outletId, farmerId, farmerName, start, end, plannedVolumeM3: Math.round(vol), expectedFlowM3s: flow, durationH: Math.round(durH * 100) / 100, needMetPct: needPct };
}

const EQUAL_WATER_TURNS: TurnRow[] = [
  turnTime("t1", "o1", "f1", "Ramaiah Kota", 1050, 98, 1),
  turnTime("t2", "o2", "f2", "Lakshmi Devi Pasupuleti", 630, 97, 3),
  turnTime("t3", "o3", "f3", "Venkata Rao Gadde", 1290, 96, 5),
  turnTime("t4", "o4", "f4", "Suresh Babu Nannapaneni", 585, 95, 8),
  turnTime("t5", "o5", "f5", "Anjamma Bandi", 210, 94, 9),
  turnTime("t6", "o6", "f6", "Srinivas Reddy Yeluri", 1000, 93, 10),
  turnTime("t7", "o7", "f7", "Padmavathi Kolli", 525, 92, 13),
  turnTime("t8", "o8", "f8", "Narasimha Chinta", 240, 91, 14),
];

const EQUAL_HOURS_TURNS: TurnRow[] = [
  turnTime("h1", "o1", "f1", "Ramaiah Kota", 1562, 100, 1),
  turnTime("h2", "o2", "f2", "Lakshmi Devi Pasupuleti", 1498, 100, 4),
  turnTime("h3", "o3", "f3", "Venkata Rao Gadde", 1436, 88, 7),
  turnTime("h4", "o4", "f4", "Suresh Babu Nannapaneni", 1370, 82, 10),
  turnTime("h5", "o5", "f5", "Anjamma Bandi", 1306, 100, 13),
  turnTime("h6", "o6", "f6", "Srinivas Reddy Yeluri", 1244, 72, 16),
  turnTime("h7", "o7", "f7", "Padmavathi Kolli", 1193, 46, 19),
  turnTime("h8", "o8", "f8", "Narasimha Chinta", 1144, 44, 22),
];

const REQUESTS: RequestRow[] = [
  {
    id: "r1", farmerId: "f1", farmerName: "Ramaiah Kota", type: "urgent", volumeM3: 180,
    reason: "Rice flowering stage, field dry, needs water today.",
    reasonTe: "వరి పూత దశ, పొలం ఎండిపోయింది, ఈరోజే నీరు కావాలి.",
    channel: "voice", status: "recommended", triageScore: 0.92,
    recommendation: {
      decision: "partial", volumeM3: 120,
      rationale: "Flowering rice is high-risk; quota has 840 m3 remaining. Recommend partial 120 m3 now, deducted from future weeks.",
      rationaleTe: "పూత దశ వరి అధిక ప్రమాదం; కోటాలో 840 మీ³ మిగిలింది. 120 మీ³ పాక్షిక మంజూరు సిఫార్సు, భవిష్యత్ వారాల నుండి తగ్గింపు.",
    },
  },
  {
    id: "r2", farmerId: "f7", farmerName: "Padmavathi Kolli", type: "buffer", volumeM3: 200,
    reason: "Requests buffer water after rain saved her turn; tail outlet short last week.",
    reasonTe: "వర్షం వల్ల మిగిలిన బఫర్ నీరు అడుగుతున్నారు; గత వారం చివరి అవుట్‌లెట్‌కు తక్కువ వచ్చింది.",
    channel: "portal", status: "recommended", triageScore: 0.61,
    recommendation: {
      decision: "approve", volumeM3: 200,
      rationale: "Buffer holds 12,400 m3. Request is public on the portal and within buffer cap. Recommend full approval.",
      rationaleTe: "బఫర్‌లో 12,400 మీ³ ఉంది. అభ్యర్థన పోర్టల్‌లో బహిరంగం, పరిమితిలో ఉంది. పూర్తి ఆమోదం సిఫార్సు.",
    },
  },
  {
    id: "r3", farmerId: "f5", farmerName: "Anjamma Bandi", type: "urgent", volumeM3: 90,
    reason: "Groundnut field, wants extra turn before weekend.",
    reasonTe: "వేరుశెనగ పొలం, వారాంతానికి ముందు అదనపు వంతు కావాలి.",
    channel: "voice", status: "recommended", triageScore: 0.35,
    recommendation: {
      decision: "reject", volumeM3: 0,
      rationale: "Low stage risk (pod-fill not started) and delivery 2 days ago met 94% of need. Recommend reject; offer scheduled turn.",
      rationaleTe: "తక్కువ దశ ప్రమాదం, 2 రోజుల క్రితం 94% అవసరం తీరింది. తిరస్కరణ సిఫార్సు; షెడ్యూల్ వంతు ఇవ్వండి.",
    },
  },
];

const LEDGER: LedgerView = {
  canalSupplyM3: 180000,
  bufferM3: 12400,
  conveyanceLossesM3: 8600,
  farmers: [
    { farmerId: "f1", name: "Ramaiah Kota", quotaM3: 16800, deliveredM3: 3150, needMetPct: 98 },
    { farmerId: "f2", name: "Lakshmi Devi Pasupuleti", quotaM3: 10080, deliveredM3: 1890, needMetPct: 97 },
    { farmerId: "f3", name: "Venkata Rao Gadde", quotaM3: 20640, deliveredM3: 3870, needMetPct: 96 },
    { farmerId: "f4", name: "Suresh Babu Nannapaneni", quotaM3: 9360, deliveredM3: 1755, needMetPct: 95 },
    { farmerId: "f5", name: "Anjamma Bandi", quotaM3: 3360, deliveredM3: 630, needMetPct: 94 },
    { farmerId: "f6", name: "Srinivas Reddy Yeluri", quotaM3: 16000, deliveredM3: 3000, needMetPct: 93 },
    { farmerId: "f7", name: "Padmavathi Kolli", quotaM3: 8400, deliveredM3: 1575, needMetPct: 92 },
    { farmerId: "f8", name: "Narasimha Chinta", quotaM3: 3840, deliveredM3: 720, needMetPct: 91 },
  ],
  conservationOk: true,
  gini: 0.18,
  entries: [
    { id: "l1", at: "2026-09-14T06:00:00Z", from: "canal_supply", to: "farmer:f1:quota", volumeM3: 16800, reason: "Season approved — f1 quota" },
    { id: "l2", at: "2026-09-14T06:00:00Z", from: "canal_supply", to: "buffer", volumeM3: 12400, reason: "Season approved — remainder to buffer" },
    { id: "l3", at: "2026-09-15T04:00:00Z", from: "farmer:f1:quota", to: "farmer:f1:delivered", volumeM3: 1050, reason: "Turn t1 delivered" },
    { id: "l4", at: "2026-09-15T04:00:00Z", from: "canal_supply", to: "losses:conveyance", volumeM3: 860, reason: "Conveyance loss turn t1" },
    { id: "l5", at: "2026-09-15T08:00:00Z", from: "farmer:f7:quota", to: "buffer", volumeM3: 200, reason: "Rain saved — moved to buffer" },
  ],
};

const AUDIT: AuditView = {
  findings: [
    { severity: "info", text: "Conservation invariant holds: supply = quotas + buffer + delivered + losses." },
    { severity: "info", text: "Equal-water Gini 0.18 vs equal-hours Gini 0.42 — equal water is fairer for tail outlets." },
    { severity: "warn", text: "2 registrations (f5, f8) still unverified — voice-only farmers need a call before rw1." },
  ],
  summaryEn: "Ledger is consistent. Equal-water roster meets >90% of need on all 8 outlets; equal hours leaves the tail at ~45%. Two voice-only registrations still need verification.",
  summaryTe: "లెడ్జర్ స్థిరంగా ఉంది. సమాన-నీరు జాబితా 8 అవుట్‌లెట్‌లలో >90% అవసరం తీరుస్తుంది; సమాన గంటలు చివరను ~45% వద్ద వదిలేస్తాయి. వాయిస్-మాత్రమే 2 నమోదులు ఇంకా ధృవీకరించాలి.",
};

/** Gini of an array of 0–100 need-met values (0 = perfectly equal). Pure helper, unit-tested. */
export function giniOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * (sorted[i] ?? 0);
  return Math.round(((2 * cum) / (n * sum) - (n + 1) / n) * 100) / 100;
}

/** Conservation check: supply = quotas + buffer + delivered + losses (tolerance 1 m3). */
export function conservationHolds(supply: number, quotas: number, buffer: number, delivered: number, losses: number): boolean {
  return Math.abs(supply - (quotas + buffer + delivered + losses)) < 1;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mock = {
  async listFarmers(): Promise<FarmerRegistration[]> {
    await delay(30);
    return structuredClone(REGISTRATIONS);
  },
  async suggestEntitlements(): Promise<{ rows: EntitlementRow[]; seasonTotalM3: number; explanationEn: string; explanationTe: string }> {
    await delay(30);
    return { rows: structuredClone(ENTITLEMENTS), seasonTotalM3: MOCK_SEASON_TOTAL_M3, explanationEn: MOCK_EXPLANATION_EN, explanationTe: MOCK_EXPLANATION_TE };
  },
  async proposeRoster(mode: "equal_water" | "equal_hours"): Promise<RosterProposal> {
    await delay(30);
    return {
      id: mode === "equal_water" ? "roster-eq-water" : "roster-eq-hours",
      mode,
      releaseWindowId: "rw1",
      turns: structuredClone(mode === "equal_water" ? EQUAL_WATER_TURNS : EQUAL_HOURS_TURNS),
      equalHoursGini: 0.42,
      equalWaterGini: 0.18,
    };
  },
  async listRequests(): Promise<RequestRow[]> {
    await delay(30);
    return structuredClone(REQUESTS);
  },
  async ledger(): Promise<LedgerView> {
    await delay(30);
    return structuredClone(LEDGER);
  },
  async audit(): Promise<{ balances: LedgerView; findings: AuditView["findings"]; summaryEn: string; summaryTe: string }> {
    await delay(30);
    return { balances: structuredClone(LEDGER), findings: structuredClone(AUDIT.findings), summaryEn: AUDIT.summaryEn, summaryTe: AUDIT.summaryTe };
  },
};
