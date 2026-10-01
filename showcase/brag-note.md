# Brag config — STUB note (C8)

`showcase/brag.config.json` is a **stub**, committed deliberately so the
showcase workstream stays independent of unfinished research.

## Why a stub

- `docs/research/brag.md` does not exist yet (checked 2026-10-01). The build
  plan marks it as the input to ADR-005 (showcase tooling), and the
  architecture overview §8 lists the showcase as *"latent-spaces/brag setup,
  [pending research]"*.
- The sub-task requires a "latent-spaces/brag config per docs/research/brag.md
  once it lands (if missing, stub + note)" — this file is that note.

## What the stub contains

Best-effort shape only: site metadata (placeholder URLs), seed-scenario
pointer, the five showcase sections mapped 1:1 to the screenshot routes
(`/farmer`, `/coordinator`, `/canal`, `/phone`, `/demo`), and the Telugu
voice line used in the pitch. Every URL is a placeholder; no secrets.

## What replaces it

When `docs/research/brag.md` lands, the orchestrator (or whoever owns
ADR-005) should:

1. Replace `brag.config.json` with the real latent-spaces/brag schema.
2. Point `baseUrl` at the deployed preview (keep `localBaseUrl` for rehearsal).
3. Wire `screenshots/out/*.png` (or the backup video) as the brag media set.
4. Delete the `"_stub"` flag and this note's "stub" status line.

Do not invent the real brag schema here — C8 stays placeholder-first and
touches only `showcase/`.
