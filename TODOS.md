# TODOS — gstack-pi extension

Single backlog for the pi extension itself — absorbed `FUTURE_UPDATES.md` (deferred
features & skill integrations) so all not-yet-built work lives in one place.
The vendored gstack source keeps its own `source/TODOS.md`; this file tracks extension-level work only.

## BACKLOG

### Ponytail integration — gated code-simplification cycle (`/gstack simplify`)

**What:** Add a new workflow to `orchestrator/workflows.ts` implementing a bounded,
gate-protected code-cleanup pass based on [ponytail](https://github.com/DietrichGebert/ponytail)
(the "lazy senior dev" minimizer skill, MIT). Shape:

1. `scan` (subagent, scout): analyze the current diff against ponytail's 7-rung ladder
   (YAGNI → reuse codebase → stdlib → native platform → installed dep → one line → minimum)
   → produce a DELETE-LIST artifact: each finding with rung number, impacted lines,
   estimated risk. Report-only.
2. `gate` (main, `advance: manual`): user approves/rejects the delete-list. Nothing is
   deleted without explicit consent — same decision-gate pattern as `develop.plan`.
3. `apply` (subagent, worker): apply ONLY approved deletions. Hard constraints:
   scope limited to the current task's diff; no public API / contract changes; tests
   green before AND after (verification-before-completion discipline).
4. `re-review` (subagent, reviewer, `optional: true`): confirm nothing essential was cut,
   reviewing only the simplification delta.

Also insert an `optional: true` `simplify` phase into the `develop` workflow between
`implement` and `qa`, with `skipWhen` on empty diff, so the full cycle becomes
implement → simplify → review → qa → ship.

Ship a distilled methodology digest (~2K tokens, `skills-distilled/`) containing the
ladder, the never-cut list (input validation at trust boundaries, data-loss error
handling, security, accessibility, anything explicitly requested), the `ponytail:`
ceiling-comment convention, and the delete-list output format — so the extension stays
self-contained whether or not the user has ponytail installed.

**Why:** Agents over-build on everyday tasks; ponytail's agentic benchmark shows ~54%
mean LOC reduction (and ~20% cost) on real repos. Injecting it ambiently into every
phase, however, directly conflicts with this pipeline's contracts: DoD requires
observability at boundaries, QA requires tests, ship requires doc phases, and an
injected reviewer told to be lazy flags fewer problems (weakened gates → thrash loops:
worker trims → review rejects → FEEDBACK retry costs more than the savings). As a
post-implement, manually-gated pass, minimization stops being ambient pressure and the
existing review/QA gates validate the deletions instead of fighting them.

**Mode mapping (from ponytail's own intensity levels):**
- `lite` ("build what's asked, name the lazier alternative in one line") is safe to
  reference from the `implement` phase instructions as an advisory nudge — it never
  blocks delivery.
- `full` / `ultra` logic must live ONLY inside the simplify cycle, never in ambient
  subagent injection. If the host also has the real ponytail plugin installed with
  always-on hooks, document setting `PONYTAIL_DEFAULT_MODE=off` for pipeline sessions
  (or scope `PONYTAIL_SUBAGENT_MATCHER`) so the two systems don't double-inject.

**Pros:** Counterweight to over-building without touching gate integrity; reuses the
existing patterns (`advance: manual`, skipWhen, skill ingestion, reviewer delta-review);
standalone `/gstack simplify` is useful on any dirty tree even outside develop.
**Cons:** One more workflow to maintain; the digest must track upstream ponytail rule
changes manually (MIT, pin a version in the digest header).

**Context / where to start:**
- Upstream ruleset: https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail/SKILL.md
  (`lite|full|ultra` intensity table + never-lazy list are normative there).
- Install (optional, for users who want the live skill alongside):
  `pi install git:github.com/DietrichGebert/ponytail`
- Files: `orchestrator/workflows.ts` (new `simplify` workflow + optional develop phase),
  `orchestrator/router.ts` + menu (intent patterns: /\b(simplify|clean ?up|delete[- ]list|dead code)\b/i),
  `skills-distilled/gstack-simplify.md` (new digest).
- Design sketched in session of 2026-08-23 (see conversation summary in `.gstack/plans/` if persisted).

### Skill digest improvements — especially `gstack-office-hours`

**What:** Review and improve all `skills-distilled/*.md` digests so they steer agent behavior
more reliably inside workflows. Priority: `gstack-office-hours.md` (planning-phase quality gate).

Pain points to address:
- Office-hours digest is persona-heavy (YC partner voice) but light on **workflow integration**:
  when to smart-skip, how to converge to a plan artifact, what handoff format the next phase
  (`develop.plan`) actually consumes. Digest should specify its output contract, not just its posture.
- Missing exit criteria: no explicit "session done when X" condition, so planning phases can loop.
- Other digests: audit each for the same gap — do they define inputs, output shape, and stop
  conditions, or only tone?

**Why:** Digests are injected into subagent prompts every session; vague ones cost tokens AND
produce mushy plans that downstream gates reject → retry loops. Sharper office-hours output =
fewer develop-plan rework cycles = better end-to-end workflow.

**Files:** `skills-distilled/gstack-office-hours.md` first, then the rest; cross-check against
phase instructions in `orchestrator/workflows.ts` so digest output matches what gates expect.

### Workflow: `/gstack design` — full design-review cycle

Same shape as `develop` / `investigate`: visual audit of the running app → severity-rated
design findings (spacing, hierarchy, consistency, AI-slop detection) → interactive fix loop
with before/after screenshots → regression pass. Build on the `gstack-design-review` skill
methodology **composed with the locally installed `impeccable` skill**
(`~/.pi/agent/skills/impeccable`) for frontend quality standards. Needs: browser tools
(already native), a taste-feedback loop (interactive, like the plan approval gate).

### Workflow: `/gstack secure` — security audit

Security audit workflow on the `gstack-cso` methodology: scout diffs → OWASP Top 10 +
STRIDE checklist phase → findings gate.

### Workflow: `/gstack retro`

Weekly retro reading session history; depends on the learnings memory below.

### Spec-as-goal entry for `develop`

Accept a `gstack-spec`-style spec file as `develop`'s goal input, skipping the interview
when a spec already exists.

### Orchestrator: `/gstack status`

Non-interactive printout of the workflow state machine (current phase x/y, results,
gate/pause state).

### Orchestrator: per-step checkpoint + `WorkflowState` versioning

Persist a checkpoint after each chain step so a session reload can resume mid-chain without
redoing scout work. Paired requirement: the persisted schema needs an explicit version field.
(`orchestrator/state.ts` + `orchestrator/telemetry.ts`.)

### Orchestrator: compaction guard

On `session_start`, if a workflow is active but the phase instructions were compacted away,
re-inject via existing `buildResumeContext()`.

### Learnings memory (pi-native gbrain substitute)

Persist per-workflow learnings to `~/.gstack/learnings/<slug>.json`; inject top-N relevant
learnings into investigate/plan phases. Needs relevance-ranking design before implementation.

### Skill promotions

- **`gstack-plan-devex-review`** — promote into planning when building developer-facing
  products (APIs, CLIs, SDKs).
- **`gstack-plan-design-review`** — promote for UI-heavy work once `/gstack design` exists.
- **skillify-assisted digests** — use the `gstack-skillify` methodology to semi-automate
  distilling new upstream skills into `skills-distilled/`.

## Efficiency plan follow-ups (deferred by EFFICIENCY_PLAN v3.1 — implemented except these)

- **Phase-level parallel waves** — parallelism must live at the `WorkflowPhase` level, not on
  chain steps (the only real chain, investigate/root-cause, must stay sequential; the
  v3-proposed wave entities did not exist in the workflows). Requirements for the future design:
  - extend `after` / `exclusive` to phase types; touches `orchestrator/state.ts` result merging;
  - `{previous}` semantics in wave mode: concat of the handoffs of the steps in `after`, in
    declared order;
  - mechanized `exclusive` guard: a test reading `tools:` from agent frontmatter
    (`~/.pi/agent/agents/*.md`) validating that a wave never mixes conflicting tools
    (git-write, ports/dev-servers, shared `.gstack`); manual annotation as override only;
  - gate handling (`advance:"manual"`) during waves; result merge in `formatDelegationResults`;
    concurrency via `GSTACK_PI_MAX_PARALLEL` (use the `numberEnv` parser in `orchestrator/config.ts`).
- **Liveness kill activation** — the observe-only liveness (`GSTACK_PI_LIVENESS_SEC`,
  spawn.ts) must NEVER terminate processes until data from at least 2 real runs shows
  false-positive rates are acceptable (gaps > 240s are normal during long builds/tests).
  Decide on run-report data in `.gstack/runs/`.
- **`{previous}` `$`-safe fix in the subagent extension** — the same unsafe-replacement bug
  class fixed here via `replaceExact` exists at `~/.pi/agent/extensions/subagent/index.ts`
  (~line 536); separate extension, out of scope for this repo.
- **Skip extension to other workflows** — the structural-skip pattern (marker-in-HANDOFF +
  file-existence guards + never-skippable validate step) currently covers investigate
  root-cause and the QA fix loop only.

## Notes

- All 23 bundled skills remain invocable manually via `/skill:gstack-*` regardless of wiring.
- Digests must stay verbatim-stable across releases where possible — provider prompt caches
  key on exact prefixes.
