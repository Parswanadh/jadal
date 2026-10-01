# Agent handbook

All agents read docs/ before working; every change is committed with a conventional-commit message.

## Parallel build (three tasks)

- Work is split into three GitHub issues: **Task A** deterministic core (`packages/core`), **Task B** backend, agents and voice (`apps/api`), and **Task C** frontend, demo and showcase (`apps/web`, `showcase/`).
- `packages/contracts` is the integration agreement. Only the orchestrator changes it; PRs that touch it need the `contracts-ok` label.
- Every PR is reviewed by the reviewer agent (`scripts/agents/review-loop.sh`), which merges passing PRs and requests specific changes on failing ones.
- Agent scratch material goes in `.ref/` (gitignored).
