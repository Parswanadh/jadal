# Jadal Launch Video — Sound Effects & Cue Points Sheet

Duration: **60.0 seconds** (Calibrated for 45–60 s polished video)  
Music Bed: `ambient-bed.wav` / `ambient-bed.ogg` (Loopable, -18.1 LUFS, volume: 0.35)  
Audio Asset Directory: `showcase/video/audio/`

---

## 1. Master SFX Cue Table

| Timecode | Asset File | Gain / Vol | Track | Visual Cue / Trigger | Audio Character & Narrative Purpose |
|---|---|---|---|---|---|
| **00:00.00** | `ambient-bed.ogg` | `0.35` | 10 | Video start, Title Card fades in | Warm, contemplative sub drone & harmonic pad (-18.1 LUFS). Sets civic, serious tone. |
| **00:09.50** | `tick.wav` | `0.55` | 11 | Canal Hero: Outlet 1 highlighted (300 m) | Soft organic UI tick. Flow = 0.145 m³/s (3.5% loss). |
| **00:10.50** | `tick.wav` | `0.55` | 11 | Outlet 2 highlighted (650 m) | Soft organic UI tick. |
| **00:11.50** | `tick.wav` | `0.55` | 11 | Outlet 3 highlighted (1000 m) | Soft organic UI tick. |
| **00:12.50** | `tick.wav` | `0.55` | 11 | Outlet 4 highlighted (1400 m) | Soft organic UI tick. |
| **00:13.50** | `tick.wav` | `0.55` | 11 | Outlet 5 highlighted (1800 m) | Soft organic UI tick. |
| **00:14.50** | `tick.wav` | `0.55` | 11 | Outlet 6 highlighted (2150 m) | Soft organic UI tick. |
| **00:15.50** | `tick.wav` | `0.55` | 11 | Outlet 7 highlighted (2550 m) | Soft organic UI tick. Need met drops towards 42%. |
| **00:16.50** | `tick.wav` | `0.70` | 11 | Outlet 8 highlighted (2900 m) | Slightly accented tick. Tail flow = 0.106 m³/s (29.4% seepage deficit). |
| **00:20.00** | `swell.wav` | `0.80` | 12 | Coordinator Console: toggle `equal_hours` → `equal_water` | **The Pivot Swell**: 3.5s ascending harmonic riser as physics recomputes turn times. |
| **00:23.50** | `chime.wav` | `0.75` | 13 | Tail need-met jumps 42% → >90%; Gini collapses 0.31 → 0.05 | Warm dual-bell confirmation chime (880 Hz + 1320 Hz) celebrating metric convergence. |
| **00:25.00** | `tick.wav` | `0.60` | 11 | Coordinator clicks "Approve Roster" | Crisp confirmation snap locking the allocation. |
| **00:33.20** | `tick.wav` | `0.50` | 11 | `/phone` modal pops up | Incoming voice simulation prompt appears. |
| **00:34.00** | *(Spoken Voice)* | `1.00` | 20 | Farmer Ramaiah speaks Telugu: *«నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»* | Spoken Telugu audio clip (~3.2s). Urgent water request. |
| **00:37.50** | `chime.wav` | `0.70` | 13 | System 1 badge (0.85) + System 2 proposal (40 m³ grant) | Gentle harmonic arrival confirming automated triage. |
| **00:39.20** | `tick.wav` | `0.65` | 11 | Coordinator approves 40 m³ grant | Double-entry quota deduction visual animation triggers. |
| **00:41.50** | `dtmf_ack.wav` | `0.70` | 14 | Voice-only farmer acknowledges: DTMF key `1` («సరే») | Authentic 150ms dual-tone (697 Hz + 1209 Hz) confirming voice phone receipt. |
| **00:46.00** | `chime.wav` | `0.80` | 13 | `/demo` Ledger card: `conservation_ok: true` green badge | Clear, resonant chime confirming invariant proof across all 8 outlets. |
| **00:54.00** | *(Music swell)* | `0.45` | 10 | End Card: *LLMs propose · Core computes · Coordinator approves* | Ambient music bed harmonically resolves to root D tonic. |
| **00:59.00** | *(Fade-out)* | `→ 0.0` | 10 | Video fades to black | 1.0s exponential audio fade out. |

---

## 2. Asset Specifications & Provenance

All files are synthesized in-tree and owned outright:

1. **`ambient-bed.wav` / `ambient-bed.ogg`**
   - **Format:** 44.1 kHz, 16-bit mono PCM WAV (5.1 MB) / OGG Vorbis (274 KB).
   - **Duration:** Exactly 60.000 s (2,646,000 samples).
   - **Integrated Loudness:** **-18.1 LUFS** (measured via `ffmpeg -af ebur128`).
   - **LRA (Loudness Range):** **1.5 LU** (smooth, non-intrusive bed).
   - **Looping:** Perfectly seamless equal-power crossfade across end/start boundary.
   - **Composition:** Sub-bass drone (D2/A2), rich mid-pad harmonics (D3/F#3/G3/A3), high acoustic pentatonic shimmer, and filtered warm ambient air.

2. **`tick.wav`**
   - **Format:** 44.1 kHz, 16-bit mono PCM WAV (3.1 KB).
   - **Duration:** 35 ms.
   - **Waveform:** 1250 Hz fundamental + 2500 Hz overtone with fast 160 s⁻¹ exponential decay.
   - **Purpose:** Soft outlet markers (o1–o8) and discrete UI click feedback.

3. **`swell.wav`**
   - **Format:** 44.1 kHz, 16-bit mono PCM WAV (302 KB).
   - **Duration:** 3.500 s.
   - **Waveform:** Exponential frequency sweep from 110 Hz (A2) to 440 Hz (A4) with quadratic amplitude envelope.
   - **Purpose:** The dramatic "Pivot" when the coordinator switches from equal hours to equal water.

4. **`chime.wav`**
   - **Format:** 44.1 kHz, 16-bit mono PCM WAV (104 KB).
   - **Duration:** 1.200 s.
   - **Waveform:** Dual resonant bell tones at 880 Hz (A5) and 1320 Hz (E6) with harmonic 1760 Hz and 4.0 s⁻¹ decay.
   - **Purpose:** Affirmative confirmation on ledger audit, need-met surge, and coordinator approval.

5. **`dtmf_ack.wav`**
   - **Format:** 44.1 kHz, 16-bit mono PCM WAV (13 KB).
   - **Duration:** 150 ms.
   - **Waveform:** Standard ITU-T DTMF Key 1 (697 Hz row + 1209 Hz column) with half-sine edge windowing.
   - **Purpose:** Telephony acknowledgement proof for voice-only farmers without smartphones.

---

## 3. HTML / Hyperframes Integration Example

```html
<!-- Ambient Music Bed -->
<audio id="bg-music" 
       data-start="0.0" 
       data-duration="60.0" 
       data-track-index="10" 
       data-volume="0.35" 
       src="assets/ambient-bed.ogg"></audio>

<!-- Outlet Tick Sequence -->
<audio id="sfx-tick-o1" data-start="9.5"  data-duration="0.1" data-track-index="11" data-volume="0.55" src="assets/tick.wav"></audio>
<audio id="sfx-tick-o8" data-start="16.5" data-duration="0.1" data-track-index="11" data-volume="0.70" src="assets/tick.wav"></audio>

<!-- Pivot Swell & Chime -->
<audio id="sfx-swell" data-start="20.0" data-duration="3.5" data-track-index="12" data-volume="0.80" src="assets/swell.wav"></audio>
<audio id="sfx-chime" data-start="23.5" data-duration="1.2" data-track-index="13" data-volume="0.75" src="assets/chime.wav"></audio>

<!-- DTMF Acknowledgement -->
<audio id="sfx-dtmf"  data-start="41.5" data-duration="0.2" data-track-index="14" data-volume="0.70" src="assets/dtmf_ack.wav"></audio>
```
