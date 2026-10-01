# Research: latent-spaces/brag Tooling

> Input to ADR for showcase tooling (Task C8 / Showcase).  
> Researched: 2026-10-02 · Status: VERIFIED with upstream sources noted.

---

## 1. What `latent-spaces/brag` Is

`latent-spaces/brag` (invoked as `/brag`) is an open-source AI agent skill and developer tool created by [latent-spaces](https://github.com/latent-spaces) (MIT License). It automates the generation of short, professional, shareable launch demo videos (typically 15–25 seconds) directly from a software codebase.

Key characteristics:
- **Code-first inspection:** Instead of requiring manual screen recording, video timeline editing, or a hosted public URL, `/brag` reads the repository's frontend code (`index.html`, `styles.css`, component routes, and copy) to understand the product, extract brand colors/fonts, and identify the key user flow.
- **Agent Skill standard:** Implemented following the Agent Skills open standard (`SKILL.md`), executable inside agent environments including Claude Code, Codex CLI, Cursor, Gemini CLI, and Copilot via the `skills` CLI.
- **Separation of Story and Build:**
  - The **`/brag` skill** owns the narrative angle, 9-question planning rubric, storyboard, tone selection, and creative brief.
  - The **[Hyperframes](https://hyperframes.heygen.com/) engine** owns the code-to-video compilation, rendering HTML/CSS/SVG/GSAP animations and audio cues deterministically into an MP4 video.
- **Slim variant (`/brag-slim`):** A lightweight variant designed for Claude Opus 5.5 that operates without the full Hyperframes toolchain and bundled assets.
- **Hosted alternative:** A no-install web version exists at [letsbrag.app](https://letsbrag.app), which runs the `/brag` pipeline given a deployed site URL.

---

## 2. Upstream Sources & References

| Resource | Canonical URL | Verification Status |
|---|---|---|
| GitHub Repository | [https://github.com/latent-spaces/brag](https://github.com/latent-spaces/brag) | VERIFIED (inspected upstream git tree & files) |
| Skill Definition (`SKILL.md`) | [https://raw.githubusercontent.com/latent-spaces/brag/main/skills/brag/SKILL.md](https://raw.githubusercontent.com/latent-spaces/brag/main/skills/brag/SKILL.md) | VERIFIED |
| Launch / Showcase Site | [https://latent-spaces.github.io/brag/](https://latent-spaces.github.io/brag/) | VERIFIED |
| Hosted Web App | [https://letsbrag.app](https://letsbrag.app) | VERIFIED |
| Hyperframes Engine | [https://hyperframes.heygen.com/](https://hyperframes.heygen.com/) | VERIFIED |
| Skills.sh Registry | [https://www.skills.sh/latent-spaces/brag/brag](https://www.skills.sh/latent-spaces/brag/brag) | VERIFIED |
| Claude Plugin Marketplace | `.claude-plugin/marketplace.json` in repo | VERIFIED |

---

## 3. How to Install & Prerequisites

### System Prerequisites
- **Node.js:** Version 22.0.0 or higher.
- **FFmpeg:** Installed and available on `$PATH` (required for video/audio muxing and encoding).
- **Hyperframes CLI:** Required for the classic/full `/brag` workflow; verified via:
  ```bash
  npx hyperframes doctor
  ```

### Installation by Agent Environment

#### Claude Code
```bash
/plugin marketplace add latent-spaces/brag
/plugin install brag@brag
```
*Note: From version 0.4.0+, the plugin automatically bundles `/brag-slim` alongside `/brag`.*

#### Codex
```bash
codex plugin marketplace add latent-spaces/brag
codex plugin add brag@brag
```

#### Generic Agent / Skills CLI (Gemini CLI, Cursor, Copilot, opencode)
```bash
# Scope to current project
npx skills add https://github.com/latent-spaces/brag --skill brag

# Or install globally across projects
npx skills add https://github.com/latent-spaces/brag --skill brag -g
```

---

## 4. Execution Workflow & How It Builds Video

The `/brag` execution pipeline consists of four distinct phases:

### Phase 1: Project Inspection (`step-1-inspect.md`)
The agent scans the workspace to answer a 9-question rubric:
1. What is the app? (1 sentence summary)
2. What is the funniest or most impressive claim? (Verbatim line that earns attention)
3. What is the visual hook? (Strongest CSS/UI moment or diagram)
4. What should be shown from the actual UI? (The hero route or core dashboard)
5. What is the shortest satisfying video? (15–25 seconds)
6. What tone fits best? (Preset + creative direction)
7. What should the audio feel like? (Music bed, SFX cues, optional narration)
8. What should the share caption say? (Single compelling postable line)
9. What is the user flow worth showing? (3 beats: entry → key action → result)

*Safety constraint: No secrets, credentials, internal API keys, or private user data are ever allowed to leave this step.*

### Phase 2: Plan & Storyboard (`step-2-plan.md`)
The agent writes `<output-dir>/brag-plan.md` (default: `brag-output/` or timestamped `brag-output-YYYY-MM-DD-HHmmss/`).  
It maps out a beat-by-beat storyboard adhering to the **Creative Laws**:
- **Duration:** 15–25 seconds strictly.
- **Structure:** `Hook (2–3s) → Reveal (2–4s) → 2–3 sharp highlights (5–12s) → Outro/punchline (2–4s)`.
- **Readability:** Fast-in motion, then hold settled (short label ~0.8s, sentence ~0.3s/word).
- **Real UI:** Shows real UI components/routes, not generic stock illustrations.

### Phase 3: Hand off to Hyperframes (`step-3-compose.md`)
The agent produces `<output-dir>/composition-brief.md` and scaffolds an HTML/CSS/GSAP composition in `<output-dir>/composition/`.  
The brief defines:
- Exact dimensions (`1920x1080` for landscape, `1080x1920` for vertical, `1080x1080` for square).
- Palette tokens extracted from the project (`--bg`, `--ink`, `--accent`).
- Verbatim copy lines.
- Audio track selection and beat sync cue points from `assets/music/cues/`.
- Passes the pre-render browser check: `npx hyperframes check`.

### Phase 4: Validate, Render & Deliver (`step-4-deliver.md`)
Hyperframes renders the final video:
- `<output-dir>/brag.mp4`: The finished 1080p MP4.
- `<output-dir>/brag.jpg`: Best poster frame selected and baked as frame 0 of the MP4.
- `<output-dir>/share-copy.txt`: 1–2 ready-to-post sentences for launch channels.

---

## 5. Tone System

`/brag` ships with seven predefined tone presets:

| Tone Preset | Energy | Target Application |
|---|---|---|
| `polished` | Serious, elegant, high craft | Premium infrastructure, developer tools, civic tech |
| `default` | Playful, clean, postable | Standard indie web apps |
| `cinematic` | Dramatic, trailer-scale | Big motion, high-stakes claims |
| `yc-parody` | Deadpan startup energy | Satirical or tongue-in-cheek products |
| `chaotic` | Fast, loud, aggressive | Meme apps, unhinged consumer utilities |
| `deadpan` | Calm, dry, understated | Minimalist, matter-of-fact projects |
| `app-store` | Smooth, feature-card clean | Consumer mobile apps, polished SaaS |

---

## 6. Config Schema Analysis: Flags vs. `brag.config.json`

### Verification Finding: Upstream Schema Status
- **VERIFIED:** The upstream `latent-spaces/brag` repository is **zero-config by default**. It is designed to be invoked directly via conversational commands or CLI flags:
  ```bash
  /brag --tone polished --format landscape --duration 20 --voice
  ```
- **VERIFIED:** Upstream does **not** distribute an official JSON schema file named `brag.schema.json` or require a static `brag.config.json` in the root repository.
- **UNVERIFIED (Upstream) / PROJECT STANDARD (Local):** In project repositories (such as Jadal), teams define a declarative `showcase/brag.config.json` manifest. This manifest bridges repository assets (fixtures, mock routes, screenshots, copy, and tone) into the brag agent's 9-question rubric and composition brief deterministically, eliminating agent guesswork during automated CI or showcase runs.

### Recommended `brag.config.json` Schema for Project Showcases

Based on the parameters consumed by `/brag`'s `step-1-inspect.md` and `step-3-compose.md`, a complete project config schema should declare:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BragProjectConfig",
  "type": "object",
  "required": ["project", "video", "creative", "branding", "narrative", "sections"],
  "properties": {
    "project": {
      "type": "object",
      "required": ["name", "tagline", "summary"],
      "properties": {
        "name": { "type": "string" },
        "tagline": { "type": "string" },
        "summary": { "type": "string" },
        "repository": { "type": "string" },
        "baseUrl": { "type": "string" }
      }
    },
    "video": {
      "type": "object",
      "required": ["format", "durationSeconds", "outputDir"],
      "properties": {
        "format": { "type": "string", "enum": ["landscape", "vertical", "square"] },
        "dimensions": {
          "type": "object",
          "properties": {
            "width": { "type": "integer" },
            "height": { "type": "integer" }
          }
        },
        "durationSeconds": { "type": "integer", "minimum": 15, "maximum": 25 },
        "fps": { "type": "integer", "default": 30 },
        "outputDir": { "type": "string" }
      }
    },
    "creative": {
      "type": "object",
      "required": ["tone", "direction", "hookPrompt"],
      "properties": {
        "tone": {
          "type": "string",
          "enum": ["default", "polished", "yc-parody", "chaotic", "deadpan", "cinematic", "app-store"]
        },
        "direction": { "type": "string" },
        "hookPrompt": { "type": "string" },
        "outroPrompt": { "type": "string" }
      }
    },
    "branding": {
      "type": "object",
      "required": ["colors", "fonts"],
      "properties": {
        "colors": {
          "type": "object",
          "properties": {
            "background": { "type": "string" },
            "surface": { "type": "string" },
            "text": { "type": "string" },
            "muted": { "type": "string" },
            "accent": { "type": "string" },
            "water": { "type": "string" }
          }
        },
        "fonts": {
          "type": "object",
          "properties": {
            "display": { "type": "string" },
            "body": { "type": "string" },
            "mono": { "type": "string" },
            "telugu": { "type": "string" }
          }
        }
      }
    },
    "narrative": {
      "type": "object",
      "properties": {
        "heroClaim": { "type": "string" },
        "voiceLine": {
          "type": "object",
          "properties": {
            "telugu": { "type": "string" },
            "english": { "type": "string" }
          }
        },
        "shareCopy": { "type": "string" }
      }
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "route", "visualType"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "route": { "type": "string" },
          "visualType": { "type": "string", "enum": ["screenshot", "ui_component", "diagram", "caption"] },
          "assetPath": { "type": "string" },
          "keyMetric": { "type": "string" }
        }
      }
    }
  }
}
```

---

## 7. Recommendations for Jadal's Showcase ADR

1. **Tone Selection:** Choose `polished` (serious, elegant, civic-tech integrity). Jadal addresses critical canal water allocation and farmer livelihoods; comedic or chaotic styles (`yc-parody`, `chaotic`) would undermine trust.
2. **Video Strategy:**
   - **Short Brag Clip (20s):** Produced by `/brag` for social/teaser sharing. Follows the `Hook → Problem → Core Proof → Telugu Voice → Ledger Balance` rapid cut.
   - **Full Hackathon Demo (180s / 3:00):** Narrated walkthrough specified in `showcase/video-script.md` covering all 6 demo steps in detail.
3. **No Secrets Policy:** The config and all brag assets must contain only mock phone numbers (`+91900000000x`), public canal fixtures (Kondaveedu Minor), and no API keys.
4. **Visual Alignment:** Use the deck's palette (`#FFFCF5` background, `#1E1B16` ink, `#E8A100` sun accent, `#3F7CA6` water) and typography (`Plus Jakarta Sans`, `Noto Sans Telugu`, `JetBrains Mono`).
