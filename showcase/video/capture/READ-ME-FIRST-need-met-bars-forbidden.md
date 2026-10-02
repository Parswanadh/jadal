# READ FIRST — orchestrator warning for the final render

`canal.png` and `canal-seepage.webm` show per-farmer "NN% of need met" bars (98%, 82%, ...).
They are the MOCK formula (`apps/web/src/api/mock.ts:322`, "ASSUMED ... illustrative"), NOT core output.
Core computes planned need-met of 280.8% (head) / 205.5% (tail) on the seed (docs/decisions/ADR-need-met-planned.md).
=> facts.md FORBIDS any need-met percentage. Use ONLY the ribbon card (top of /canal) + the flow labels
0.145 / 0.106 m3/s, 3.5% / 29.4%, or the motion graphic. Crop the bars out. Any frame showing them fails QA.
Also: the "Outlet 1" label is clipped by its marker in the ribbon — no close-up there.
Also re-read showcase/video/facts.md section 2b: it was updated after you may have first read it.
