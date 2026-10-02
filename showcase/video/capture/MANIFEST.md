# Jadal Launch Video Footage Manifest

Recorded on: 2026-10-02
Environment: MOCK mode (`VITE_MOCK=1`), zero secrets, local deterministic fixtures.
Server: Vite dev server on `http://127.0.0.1:5311` (strict port).
Browser: Chromium / Google Chrome via Playwright at standard 1080p desktop viewport (1920x1080).
Total footage size: **3.72 MB** (budget: ~25 MB).

## Captured Artifacts

| File | Route | Viewport | Format | Size | Duration | Description |
|---|---|---|---|---|---|---|
| `home.png` | `/` | 1920x1080 | PNG Image | 156.5 KB | N/A | Hero cover page: Jadal core value proposition, problem summary, and system navigation. |
| `login.png` | `/login` | 1920x1080 | PNG Image | 63.2 KB | N/A | Authentication screen: Role selector (Farmer / Coordinator) with password entry. |
| `canal.png` | `/canal` | 1920x1080 | PNG Image | 129.7 KB | N/A | Canal seepage visualization: 3 km ribbon showing physical flow drop (0.145 to 0.106 m³/s) and need-met percentages. |
| `phone.png` | `/phone` | 1920x1080 | PNG Image | 101.8 KB | N/A | Farmer phone simulator: Interactive handset testing Telugu voice calls and IVR schedule confirmation. |
| `demo.png` | `/demo` | 1920x1080 | PNG Image | 118.4 KB | N/A | End-to-end demo console: 6-step walkthrough runner, simulated clock controls, and audit event stream. |
| `farmer.png` | `/farmer` | 1920x1080 | PNG Image | 132.1 KB | N/A | Farmer portal (post-login): "My Water" turn allocation, next release schedule, soil moisture, and crop need. |
| `coordinator.png` | `/coordinator` | 1920x1080 | PNG Image | 118.8 KB | N/A | Coordinator console (post-login): Request triage queue, farmer registrations, entitlement proposals, and roster comparison. |
| `canal-seepage.webm` | `/canal` | 1920x1080 @ 30fps | WebM (VP9) | 1592.3 KB | 9.57 s | Screen recording of /canal: Interactive toggle between Equal Hours and Equal Water models, and overrun outlet selection. |
| `demo.webm` | `/demo` | 1920x1080 @ 30fps | WebM (VP9) | 1394.6 KB | 9.00 s | Screen recording of /demo: Walkthrough execution of Step 1 (roster fairness comparison) and simulation clock advancement (+6h). |

## Quality & Integrity Verifications

1. **i18n Key Parity:** Every visible screen was checked for missing or unrendered translation keys. Zero raw keys (`[i18n] missing translation key`) were observed.
2. **Error States:** Zero unhandled errors or `.notice-crit` alert banners on any captured screen.
3. **Water Figure Provenance:** All water volumes, flow rates, and turn hours rendered in the UI originate deterministically from `@jadal/core` fixtures.
4. **Compression:** All PNG files were compressed using `ffmpeg` mixed prediction filter with zlib level 9 compression. Video recordings were encoded in VP9 webm format at 1080p 30fps.
