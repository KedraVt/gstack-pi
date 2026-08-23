# Future Updates — gstack-pi backlog

Deliberately deferred features and skill integrations. Each entry has a natural landing spot in the codebase; pick one up by branching from `feat/skill-ingestion` (or its merge target).

## Workflows

- **`/gstack design`** — full design-review workflow (same shape as `develop` / `investigate`): visual audit of the running app → severity-rated design findings (spacing, hierarchy, consistency, AI-slop detection) → interactive fix loop with before/after screenshots → regression pass. Build on the `gstack-design-review` skill methodology **composed with the locally installed `impeccable` skill** (`~/.pi/agent/skills/impeccable`) for frontend quality standards. Needs: browser tools (already native), a taste-feedback loop (interactive, like the plan approval gate).
- **`/gstack secure`** — security audit workflow on the `gstack-cso` methodology: scout diffs → OWASP Top 10 + STRIDE checklist phase → findings gate.
- **`/gstack retro`** — weekly retro reading session history; depends on the learnings memory below.
- **Spec-as-goal entry** — accept a `gstack-spec`-style spec file as `develop`'s goal input, skipping the interview when a spec already exists.

## Orchestrator features

- **`/gstack status`** — non-interactive printout of the workflow state machine (current phase x/y, results, gate/pause state).
- **Per-step checkpoint + `WorkflowState` versioning** — persist a checkpoint after each chain step so a session reload can resume mid-chain without redoing scout work. Paired requirement: the persisted schema needs an explicit version field. (`orchestrator/state.ts` + `orchestrator/telemetry.ts`.)
- **Compaction guard** — on `session_start`, if a workflow is active but the phase instructions were compacted away, re-inject via existing `buildResumeContext()`.
- **Learnings memory (pi-native gbrain substitute)** — persist per-workflow learnings to `~/.gstack/learnings/<slug>.json`; inject top-N relevant learnings into investigate/plan phases. Needs relevance-ranking design before implementation.

## Skill promotions

- **`gstack-plan-devex-review`** — promote into planning when building developer-facing products (APIs, CLIs, SDKs).
- **`gstack-plan-design-review`** — promote for UI-heavy work once `/gstack design` exists.
- **skillify-assisted digests** — use the `gstack-skillify` methodology to semi-automate distilling new upstream skills into `skills-distilled/`.

## Notes

- All 23 bundled skills remain invocable manually via `/skill:gstack-*` regardless of wiring.
- Digests must stay verbatim-stable across releases where possible — provider prompt caches key on exact prefixes.

## Efficiency plan follow-ups (deferred by EFFICIENCY_PLAN v3.1)

- **Phase-level parallel waves** — parallelism must live at the `WorkflowPhase` level, not on chain steps (the only real chain, investigate/root-cause, must stay sequential; the v3-proposed wave entities did not exist in the workflows). Requirements for the future design:
  - extend `after` / `exclusive` to phase types; touches `orchestrator/state.ts` result merging;
  - `{previous}` semantics in wave mode: concat of the handoffs of the steps in `after`, in declared order;
  - mechanized `exclusive` guard: a test reading `tools:` from agent frontmatter (`~/.pi/agent/agents/*.md`) validating that a wave never mixes conflicting tools (git-write, ports/dev-servers, shared `.gstack`); manual annotation as override only;
  - gate handling (`advance:"manual"`) during waves; result merge in `formatDelegationResults`; concurrency via `GSTACK_PI_MAX_PARALLEL` (use the `numberEnv` parser in `orchestrator/config.ts`).
- **Liveness kill activation** — the observe-only liveness (`GSTACK_PI_LIVENESS_SEC`, spawn.ts) must NEVER terminate processes until data from at least 2 real runs shows false-positive rates are acceptable (gaps > 240s are normal during long builds/tests). Decide on run-report data in `.gstack/runs/`.
- **`{previous}` `$`-safe fix in the subagent extension** — the same unsafe-replacement bug class fixed here via `replaceExact` exists at `~/.pi/agent/extensions/subagent/index.ts` (~line 536); separate extension, out of scope for this repo.
- **Skip extension to other workflows** — the structural-skip pattern (marker-in-HANDOFF + file-existence guards + never-skippable validate step) currently covers investigate root-cause and the QA fix loop only.
