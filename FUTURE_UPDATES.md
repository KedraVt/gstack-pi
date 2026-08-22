# Future Updates — gstack-pi backlog

Deliberately deferred features and skill integrations. Each entry has a natural landing spot in the codebase; pick one up by branching from `feat/skill-ingestion` (or its merge target).

## Workflows

- **`/gstack design`** — full design-review workflow (same shape as `develop` / `investigate`): visual audit of the running app → severity-rated design findings (spacing, hierarchy, consistency, AI-slop detection) → interactive fix loop with before/after screenshots → regression pass. Build on the `gstack-design-review` skill methodology **composed with the locally installed `impeccable` skill** (`~/.pi/agent/skills/impeccable`) for frontend quality standards. Needs: browser tools (already native), a taste-feedback loop (interactive, like the plan approval gate).
- **`/gstack secure`** — security audit workflow on the `gstack-cso` methodology: scout diffs → OWASP Top 10 + STRIDE checklist phase → findings gate.
- **`/gstack retro`** — weekly retro reading session history; depends on the learnings memory below.
- **Spec-as-goal entry** — accept a `gstack-spec`-style spec file as `develop`'s goal input, skipping the interview when a spec already exists.

## Orchestrator features

- **`/gstack status`** — non-interactive printout of the workflow state machine (current phase x/y, results, gate/pause state).
- **Spawn retry-once** — transient subagent pi-startup failures auto-retry once before failing the phase (`orchestrator/spawn.ts`).
- **Compaction guard** — on `session_start`, if a workflow is active but the phase instructions were compacted away, re-inject via existing `buildResumeContext()`.
- **Learnings memory (pi-native gbrain substitute)** — persist per-workflow learnings to `~/.gstack/learnings/<slug>.json`; inject top-N relevant learnings into investigate/plan phases. Needs relevance-ranking design before implementation.

## Skill promotions

- **`gstack-plan-devex-review`** — promote into planning when building developer-facing products (APIs, CLIs, SDKs).
- **`gstack-plan-design-review`** — promote for UI-heavy work once `/gstack design` exists.
- **skillify-assisted digests** — use the `gstack-skillify` methodology to semi-automate distilling new upstream skills into `skills-distilled/`.

## Notes

- All 23 bundled skills remain invocable manually via `/skill:gstack-*` regardless of wiring.
- Digests must stay verbatim-stable across releases where possible — provider prompt caches key on exact prefixes.
