# Jadal Voice Messages Catalogue

> [!WARNING]
> **Telugu Translation Notice**: The Telugu copy documented here and shipped in the voice templates is machine-written and **NOT native-reviewed**. A native Telugu speaker must review and audit these strings before live field deployment. All new and modified strings are indexed in `docs/review/telugu-native-review.csv`.

This document catalogues every situation where the Jadal voice agent speaks to a farmer or canal coordinator. It tailors the messages to the Kondaveedu Minor canal case study (3 km unlined canal, 8 outlets, Andhra Pradesh) where warabandi turns (previously equal hours) are sized by equal delivered volume, compensating tail-end farms for conveyance seepage losses.

---

## Design Principles for Voice Messages

1. **Short Phone Breath**: Every farmer message is designed to be spoken in under 25 seconds (typically 12–22 s) so it fits in a single phone breath and does not fatigue or confuse the listener on a mobile connection.
2. **Plain Explanation without Math**:
   - Next turn: states the day (IST calendar date `DD-MM-YYYY`), time window (IST `HH:MM` start to end), and outlet.
   - Why turn lengths differ: "Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water" ("దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు."). Never mentions Gini coefficient, percentages, or crop water need ratios.
   - Next action: clearly instructs the listener what to do next ("Press 1 to confirm, or speak your reply").
3. **Coordinator Safety**:
   - The coordinator hears the farmer's name, requested water volume in m³, and reason verbatim.
   - Strictly states that **nothing is final until the coordinator approves**.
   - Water volumes come strictly from deterministic facts, never computed in prose.
4. **Natural Spoken Telugu**: Uses respectful honorific vocatives (`... గారు`), natural syntax, and no Latin letters except units/brand names (`m3`, `IST`, `Jadal`).

---

## Catalogue of Voice Messages

### 1. Coordinator Alert for Raised Request (`notifyCoordinatorOfRequest`)
* **When it fires**: Outbound call initiated when a farmer raises an urgent or buffer request.
  - Call site: `apps/api/src/requests.ts:168` (invoked via `raiseRequest()`), defined at `apps/api/src/coordinator-alert.ts:353`.
* **Who hears it**: Canal Coordinator (`COORDINATOR_PHONE`).
* **Variables used**:
  - `{farmer}`: Farmer name (from database or ID fallback)
  - `{volume}`: Volume in m³ (`formatVolumeM3(request.volume_m3)`)
  - `{reason}`: Reason text from request
* **English Text**:
  > "Hello, this is the Jadal canal office calling. {farmer} has raised a request for {volume} cubic metres of water. Reason: {reason}. This request needs your approval, and nothing is final until you approve. Press 1 to approve, or press 2 to reject."
* **Telugu Text**:
  > "నమస్కారం, జడల్ కాలువ కార్యాలయం నుండి కాల్. {farmer} గారు {volume} ఘన మీటర్ల నీటి కోసం అభ్యర్థన పెట్టారు. కారణం: {reason}. ఈ అభ్యర్థనకు మీ ఆమోదం కావాలి, మీరు ఆమోదించే వరకు ఏదీ ఖరారు కాదు. ఆమోదించడానికి 1 నొక్కండి, తిరస్కరించడానికి 2 నొక్కండి."
* **Approximate spoken duration**: ~14 seconds.

---

### 2. Farmer Allocation Alert (`notifyFarmerOfAllocation`)
* **When it fires**: Outbound call when the coordinator approves an urgent request.
  - Call site: `apps/api/src/routes/requests.ts:258` (in `POST /api/requests/:id/decide`), defined at `apps/api/src/coordinator-alert.ts:608`.
* **Who hears it**: Farmer (`Farmer.phone`).
* **Variables used**: `farmerName`, `requestStatus` ("approved"), `requestVolumeM3`, `windowStart`, `windowEnd`, `outletName`, `chainageM`, `isLongerTurn`.
* **English Text**:
  > "Jadal: status of your water request. Hello {farmerName}, Status: approved. You asked for {requestVolumeM3} cubic metres. {outletName} (chainage {chainageM} m). Expected release: from {start} to {end} IST. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Contact the canal office for details."
* **Telugu Text**:
  > "జడల్: మీ నీటి అభ్యర్థన స్థితి. నమస్కారం {farmerName} గారు, స్థితి: ఆమోదించబడింది. మీరు అభ్యర్థించిన పరిమాణం {requestVolumeM3} ఘన మీటర్లు. {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). ఎప్పుడు పొందుతారో అయితే: {start} నుండి {end} IST వరకు. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] వివరాలకు మా కాలువ కార్యాలయాన్ని సంప్రదించండి."
* **Approximate spoken duration**: ~17 seconds (~22 seconds with seepage explanation).

---

### 3. Next Turn Details (`nextTurn`)
* **When it fires**: Outbound scheduled call or Inbound inquiry when farmer asks about their release schedule.
  - Call sites: `apps/api/src/telephony/inbound.ts:270`, `apps/api/src/voice/script.ts:121`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `windowStart`, `windowEnd`, `outletName`, `chainageM`, `allocatedM3`, `isLongerTurn`.
* **English Text**:
  > "Jadal: details of your next water turn. Hello {farmerName}, Your release day is on {date}. The release window is from {start} to {end} IST. {outletName} (chainage {chainageM} m). Your allocated volume is {allocatedM3} cubic metres. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Please be ready on time. Press 1 to confirm, or speak your reply."
* **Telugu Text**:
  > "జడల్: మీ తదుపరి నీటి వంతు వివరాలు. నమస్కారం {farmerName} గారు, మీ విడుదల రోజు {date} రోజు. విడుదల సమయం {start} నుండి {end} IST వరకు. {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). మీకు కేటాయించిన పరిమాణం {allocatedM3} ఘన మీటర్లు. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] దయచేసి సమయానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి."
* **Approximate spoken duration**: ~18 seconds (~23 seconds with seepage explanation).

---

### 4. Roster Rescheduled Alert (`rosterChange`)
* **When it fires**: Outbound call queued by campaign escalation after a re-plan.
  - Call sites: `apps/api/src/campaigns/escalation.ts:261`, `apps/api/src/coordinator-alert.ts:466`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `outletName`, `chainageM`, `windowStart`, `windowEnd`, `allocatedM3`, `isLongerTurn`.
* **English Text**:
  > "Jadal: your water turn has been rescheduled. Hello {farmerName}, {outletName} (chainage {chainageM} m). Your release day is on {date}. Your release window is from {start} to {end} IST. Your allocated volume is {allocatedM3} cubic metres. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Please be ready at the new time. Press 1 to confirm, or speak your reply."
* **Telugu Text**:
  > "జడల్: మీరు పొందబోయే నీటి వంతులో మార్పు జరిగింది. నమస్కారం {farmerName} గారు, {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). మీ విడుదల రోజు {date} రోజు. మీరు పొందే విడుదల సమయం {start} నుండి {end} IST వరకు. మీకు కేటాయించిన పరిమాణం {allocatedM3} ఘన మీటర్లు. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] కొత్త సమయానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి."
* **Approximate spoken duration**: ~18 seconds (~23 seconds with seepage explanation).

---

### 5. Night Release Warning (`nightReleaseWarning`)
* **When it fires**: Outbound alert for releases scheduled during night hours (18:00–06:00 IST, typically 23:00 or 02:00) or urgent coordinator alert.
  - Call sites: `apps/api/src/campaigns/escalation.ts:261`, `apps/api/src/coordinator-alert.ts:465`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `outletName`, `chainageM`, `windowStart`, `windowEnd`, `allocatedM3`, `isLongerTurn`.
* **English Text**:
  > "Jadal: night water-release alert. Hello {farmerName}, {outletName} (chainage {chainageM} m). The release day is on {date}. Your release starts from {start} to {end} IST. You will receive {allocatedM3} cubic metres. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Please be ready to open your field gate. Press 1 to confirm, or speak your reply. Call the canal office at once if the water does not reach you."
* **Telugu Text**:
  > "జడల్: రాత్రి నీటి విడుదల హెచ్చరిక. నమస్కారం {farmerName} గారు, {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). విడుదల రోజు {date} రోజు. మీ విడుదల {start} నుండి {end} IST వరకు ప్రారంభమవుతుంది. మీరు {allocatedM3} ఘన మీటర్లు పొందుతారు. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] దయచేసి పొలం గేటు తెరవడానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి. నీరు రాలేదంటే మా కాలువ కార్యాలయానికి వెంటనే తెలియజేయండి."
* **Approximate spoken duration**: ~20 seconds (~24 seconds with seepage explanation).

---

### 6. Turn Reminder (`reminder`)
* **When it fires**: Outbound reminder call dispatched 2–4 hours ahead of release window.
  - Call site: `apps/api/src/campaigns/escalation.ts:261`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `outletName`, `chainageM`, `windowStart`, `windowEnd`, `allocatedM3`, `isLongerTurn`.
* **English Text**:
  > "Jadal: reminder about your water turn. Hello {farmerName}, {outletName} (chainage {chainageM} m). The release day is on {date}. Your release starts from {start} to {end} IST. {allocatedM3} cubic metres of water is available for you. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Please open your field gate on time. Press 1 to confirm, or speak your reply."
* **Telugu Text**:
  > "జడల్: మీ నీటి వంతు గుర్తింపు. నమస్కారం {farmerName} గారు, {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). విడుదల రోజు {date} రోజు. రాబోయే విడుదల {start} నుండి {end} IST వరకు ప్రారంభమవుతుంది. మీకు {allocatedM3} ఘన మీటర్లు నీరు అందుబాటులో ఉంటుంది. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] దయచేసి సమయానికి పొలం గేటు తెరవండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి."
* **Approximate spoken duration**: ~16 seconds (~21 seconds with seepage explanation).

---

### 7. Rain Postponement (`rainPostponed`)
* **When it fires**: Outbound call when weather forecast detects `precipitation_sum >= 15.0 mm` deferring turns to the common buffer pool.
  - Call site: `apps/api/src/campaigns/workflows.ts:145`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `rainMm`, `outletName`, `chainageM`, `windowStart`, `windowEnd`, `allocatedM3`, `leadHours`.
* **English Text**:
  > "Jadal: your water release has been postponed because of rain. Hello {farmerName}, {rainMm} mm of rain is forecast. {outletName} (chainage {chainageM} m). the release starting from {start} to {end} IST has been postponed. in about {leadHours} hours, your allocated volume of {allocatedM3} cubic metres is carried forward unchanged. Your quota is safe. We will tell you the new time as soon as it is fixed."
* **Telugu Text**:
  > "జడల్: వర్షం కారణంగా మీ నీటి విడుదల వాయిదా వేయబడింది. నమస్కారం {farmerName} గారు, రోజువారీ {rainMm} మిమీ వర్షం నమోదైంది. {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). {start} నుండి {end} IST వరకు ప్రారంభమయ్యే విడుదల వాయిదా అయింది. రోజువారీ {leadHours} గంటల్లో మీకు కేటాయించిన పరిమాణం {allocatedM3} ఘన మీటర్లు ఉంచబడుతుంది. మీ కోటా సురక్షితంగా ఉంది. కొత్త సమయం తెలిసిన వెంటనే తెలియజేస్తాము."
* **Approximate spoken duration**: ~19 seconds.

---

### 8. Inbound Greeting (`inboundGreeting`)
* **When it fires**: When a farmer dials into the canal system.
  - Call site: `apps/api/src/telephony/inbound.ts:161` (`POST /api/telephony/inbound`).
* **Who hears it**: Inbound Farmer caller.
* **Variables used**: `farmerName` (inferred from caller phone number mapping).
* **English Text**:
  > "Hello {farmerName}, this is the Jadal canal help desk. Tell us your water problem." (or "Hello, this is the Jadal canal help desk. Tell us your water problem.")
* **Telugu Text**:
  > "నమస్కారం {farmerName} గారు, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి." (or "నమస్కారం, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి.")
* **Approximate spoken duration**: ~4 seconds.

---

### 9. Inbound Prompt (`INBOUND_PROMPT`)
* **When it fires**: Follows immediately after the inbound greeting.
  - Call site: `apps/api/src/telephony/inbound.ts:162`.
* **Who hears it**: Inbound Farmer caller.
* **Variables used**: None.
* **English Text**:
  > "Press 1 to confirm your water turn, press 2 for an urgent request. Or speak and tell us your problem."
* **Telugu Text**:
  > "1 నొక్కండి మీ నీటి వంతు నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం. లేదా మాట్లాడి మీ సమస్యను చెప్పండి."
* **Approximate spoken duration**: ~7 seconds.

---

### 10. Listen Cue (`LISTEN_CUE`)
* **When it fires**: Immediately preceding `<Record>` voice recording.
  - Call site: `apps/api/src/telephony/inbound.ts:211`.
* **Who hears it**: Inbound Farmer caller.
* **Variables used**: None.
* **English Text**:
  > "Please speak after the beep."
* **Telugu Text**:
  > "బీప్ శబ్దం తర్వాత మాట్లాడండి."
* **Approximate spoken duration**: ~2 seconds.

---

### 11. Request Approved Confirmation (`requestApproved`)
* **When it fires**: Inbound query or direct audio message confirming approved request details.
  - Call site: `apps/api/src/voice/script.ts:123`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `requestVolumeM3`, `windowStart`, `windowEnd`, `outletName`, `chainageM`, `isLongerTurn`.
* **English Text**:
  > "Jadal: your urgent request has been approved. Hello {farmerName}, You have been granted {requestVolumeM3} cubic metres. The release day is on {date}. The release window is from {start} to {end} IST. {outletName} (chainage {chainageM} m). [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] Please be ready on time. Press 1 to confirm, or speak your reply."
* **Telugu Text**:
  > "జడల్: మీ అత్యవసర అభ్యర్థన ఆమోదించబడింది. నమస్కారం {farmerName} గారు, మీకు {requestVolumeM3} ఘన మీటర్లు మంజూరు చేయబడ్డాయి. విడుదల రోజు {date} రోజు. విడుదల సమయం {start} నుండి {end} IST వరకు. {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] దయచేసి సమయానికి సిద్ధంగా ఉండండి. నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి."
* **Approximate spoken duration**: ~16 seconds (~21 seconds with seepage explanation).

---

### 12. Inbound Request Logged (`requestRecorded`)
* **When it fires**: Confirms receipt of urgent voice request after inbound transcription.
  - Call site: `apps/api/src/telephony/inbound.ts:264`.
* **Who hears it**: Farmer.
* **Variables used**: `farmerName`, `requestVolumeM3`, `outletName`, `chainageM`.
* **English Text**:
  > "Jadal: your urgent request has been recorded. Hello {farmerName}, You asked for {requestVolumeM3} cubic metres. {outletName} (chainage {chainageM} m). Our canal office will contact you shortly. Thank you."
* **Telugu Text**:
  > "జడల్: మీ అత్యవసర అభ్యర్థన నమోదు చేయబడింది. నమస్కారం {farmerName} గారు, మీరు అడిగిన పరిమాణం {requestVolumeM3} ఘన మీటర్లు. {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). మా కాలువ కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు."
* **Approximate spoken duration**: ~10 seconds.

---

### 13. Severity Alerts (`alert`: info, warning, urgent, emergency)
* **When it fires**: Outbound coordinator alert by severity band.
  - Call site: `apps/api/src/voice/script.ts:127`.
* **Who hears it**: Farmer.
* **Variables used**: `severity`, `farmerName`, `outletName`, `chainageM`, `windowStart`, `windowEnd`, `allocatedM3`, `isLongerTurn`.
* **English Text**:
  > "Jadal {Information/Warning/Urgent alert/Emergency}: Hello {farmerName}, {outletName} (chainage {chainageM} m). The release day is on {date}. The release window is from {start} to {end} IST. {allocatedM3} of water for you. [Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water.] {Closing}."
* **Telugu Text**:
  > "జడల్ {సమాచారం/హెచ్చరిక/అత్యవసర హెచ్చరిక/అత్యవసరం}: నమస్కారం {farmerName} గారు, {outletName} వద్ద (చెయినేజీ {chainageM} మీటర్లు). విడుదల రోజు {date} రోజు. విడుదల సమయం {start} నుండి {end} IST వరకు. మీకు {allocatedM3} ఘన మీటర్లు నీరు. [దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు.] {Closing}."
* **Approximate spoken duration**: ~14 to ~20 seconds.

---

### 14. Acknowledgement Recorded (`ackRecorded` & `THANKS_TE`)
* **When it fires**: Keypad DTMF 1 confirmation on outbound or inbound call.
  - Call sites: `apps/api/src/telephony/routes.ts:162`, `apps/api/src/telephony/inbound.ts:191`.
* **Who hears it**: Farmer.
* **English Text**:
  > "Thank you. Your response has been recorded."
* **Telugu Text**:
  > "ధన్యవాదాలు. మీ సమాధానం నమోదు చేయబడింది."
* **Approximate spoken duration**: ~3 seconds.

---

### 15. Honest System Failure Modes
When the voice system cannot perform an action, it provides truthful spoken feedback rather than dead air or fake confirmations:

| Condition | Call Site | English | Telugu | Duration |
|:---|:---|:---|:---|:---|
| Speech not understood | `telephony/inbound.ts:240` | "Sorry, we could not hear that clearly. Please try again." | "క్షమించండి, మీ మాటలు స్పష్టంగా వినిపించలేదు. దయచేసి మళ్లీ ప్రయత్నించండి." | ~4 s |
| Unregistered caller | `telephony/inbound.ts:261` | "Sorry, this phone number is not in our records. Please contact our canal office." | "క్షమించండి, ఈ ఫోన్ నంబర్ మా రికార్డులో లేదు. దయచేసి మా కాలువ కార్యాలయాన్ని సంప్రదించండి." | ~4 s |
| Schedule hold (no turn facts) | `telephony/inbound.ts:270` | "Jadal: our office will contact you shortly about your release time." | "జడల్: మీ విడుదల సమయం గురించి మా కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది." | ~4 s |
| Database write failed | `telephony/inbound.ts:264` | "Sorry, we could not record your request. Please try again." | "క్షమించండి, మీ అభ్యర్థనను నమోదు చేయలేకపోయాము. దయచేసి మళ్లీ ప్రయత్నించండి." | ~4 s |
| Expired / deleted contact | `telephony/routes.ts:77` | "This call is no longer available. Please contact the canal office." | "జడల్: ఈ కాల్ వివరాలు ఇప్పుడు అందుబాటులో లేవు. దయచేసి మా కాలువ కార్యాలయానికి కాల్ చేయండి." | ~4 s |
