// C5 canal hero — bilingual strings (English + Telugu).
// Every UI label exists in both languages. Record<StringKey, string> on both
// sides makes a missing translation a typecheck error.

export type Lang = "en" | "te";

export type StringKey =
  | "title"
  | "subtitle"
  | "head"
  | "tail"
  | "flowAtOutlet"
  | "chainage"
  | "modeLabel"
  | "equalHours"
  | "equalWater"
  | "equalHoursHint"
  | "equalWaterHint"
  | "needMet"
  | "needMetUnit"
  | "fairnessNote"
  | "overrunTitle"
  | "overrunOutlet"
  | "overrunHours"
  | "overrunDownstream"
  | "overrunTotal"
  | "overrunNone"
  | "overrunTailNote"
  | "sourceApi"
  | "sourceMock"
  | "dataNote"
  | "themeLabel"
  | "langLabel"
  | "kmUnit";

export const STR: Record<Lang, Record<StringKey, string>> = {
  en: {
    title: "Canal water map",
    subtitle: "One canal, 8 farms — see how far the water travels.",
    head: "Head",
    tail: "Tail",
    flowAtOutlet: "Flow at outlet",
    chainage: "Chainage",
    modeLabel: "Roster comparison",
    equalHours: "Equal hours",
    equalWater: "Equal water",
    equalHoursHint: "Every farm gets the same turn length.",
    equalWaterHint: "Turns are sized so each farm gets its share of water.",
    needMet: "% need met",
    needMetUnit: "% of need met",
    fairnessNote:
      "Under equal hours the tail farm meets about 40% of its need. Equal water closes the gap.",
    overrunTitle: "What does an overrun cost downstream?",
    overrunOutlet: "Outlet that overruns",
    overrunHours: "Overrun duration",
    overrunDownstream: "Water lost downstream",
    overrunTotal: "Total downstream loss",
    overrunNone: "No overrun — nothing is lost downstream.",
    overrunTailNote: "The tail outlet has no farms downstream of it.",
    sourceApi: "Live API",
    sourceMock: "Seed data (API not deployed yet)",
    dataNote: "All figures come from the Jadal API or its seed — this page never computes water volumes.",
    themeLabel: "Theme",
    langLabel: "Language",
    kmUnit: "km",
  },
  te: {
    title: "కాలువ నీటి పటం",
    subtitle: "ఒక కాలువ, 8 పొలాలు — నీరు ఎంత దూరం వెళ్తుందో చూడండి.",
    head: "హెడ్",
    tail: "టెయిల్",
    flowAtOutlet: "ఔట్‌లెట్ వద్ద ప్రవాహం",
    chainage: "చైనేజీ",
    modeLabel: "రోస్టర్ పోలిక",
    equalHours: "సమాన గంటలు",
    equalWater: "సమాన నీరు",
    equalHoursHint: "ప్రతి పొలానికి ఒకే సమయం.",
    equalWaterHint: "ప్రతి పొలానికి వాటా నీరు అందేలా సమయం.",
    needMet: "అవసరంలో % తీరింది",
    needMetUnit: "అవసరంలో తీరిన %",
    fairnessNote: "సమాన గంటల్లో చివరి పొలానికి అవసరంలో 40% మాత్రమే తీరుతుంది. సమాన నీరు ఈ అంతరాన్ని తగ్గిస్తుంది.",
    overrunTitle: "ఓవర్‌రన్ వల్ల కింది పొలాలు ఎంత నీరు కోల్పోతాయి?",
    overrunOutlet: "ఓవర్‌రన్ చేసే ఔట్‌లెట్",
    overrunHours: "ఓవర్‌రన్ సమయం",
    overrunDownstream: "కింద కోల్పోయిన నీరు",
    overrunTotal: "మొత్తం నష్టం",
    overrunNone: "ఓవర్‌రన్ లేదు — కింద నష్టం లేదు.",
    overrunTailNote: "చివరి ఔట్‌లెట్ కింద పొలాలు లేవు.",
    sourceApi: "లైవ్ API",
    sourceMock: "సీడ్ డేటా (API ఇంకా రాలేదు)",
    dataNote: "అన్ని సంఖ్యలు జాదల్ API లేదా సీడ్ నుండి — ఈ పేజీ నీటి లెక్కలు చేయదు.",
    themeLabel: "థీమ్",
    langLabel: "భాష",
    kmUnit: "కి.మీ",
  },
};
