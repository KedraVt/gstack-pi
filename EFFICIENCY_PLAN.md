# gstack-pi — EFFICIENCY PLAN v3.1: "Injection Correctness" (corrected edition)

> **Status:** APPROVED, NOT YET IMPLEMENTED. Working branch: `feat/skill-ingestion`.
> **Origin:** merge of `EFFICIENCY_PLAN.md` v3 and `correction-plan.md` (code-verified review, 2026-08-23). This document is SELF-CONTAINED and fully supersedes both; every quoted anchor-text was verified against the repo on that date.
> **Executor:** follow the steps in order, with no design deviations. If an anchor-text no longer matches (code evolves), find the closest equivalent, adapt minimally, and document the deviation in the commit message.
> **Iron rule:** ALL fixes are implemented BEFORE any live test. One step = 1 atomic commit, suite always green (starts at 54 top-level tests in `test/orchestrator.test.ts`).

---

## 0. Context, diagnosis, invariants

### 0.1 Evidence from the real session of 2026-08-22 (investigate cycle)

| Phase | Duration | Observed problem |
|---|---|---|
| reproduce | 4.5 min | drift: a complete diagnosis produced during the reproduction-only phase |
| root-cause | **80 min** | scout→planner chain re-run entirely although the cause was already known |
| gate | — | approval requested on a redundant/pre-concluded diagnosis |
| fix | 18 min | ok but with bloated prefill |
| regression-qa | 20 min (timeout) | process killed mid-sentence, output masked as "completed", QA redone by main (+10 min) |

### 0.2 Root cause (confirmed): INJECTION ERRORS on subagents

- **E1 — Full digest in EVERY chain step.** `buildTaskSkills()` applies the identical phase digest to each step (templates.ts:368): in the root-cause chain both scout AND planner receive the whole methodology, although the planner uses only its fix-strategy.
- **E2 — `{previous}` passes the ENTIRE output** (12K char cap, executor.ts:183-188): huge prefill on every turn of the receiver, and its system prompt still invites it to re-verify files → duplicated turns.
- **E3 — No stop condition / wrong order in tasks**: methodology arrives BEFORE the objective → the model follows the method instead of the deliverable → turn explosion. Total time ≈ turns × latency-per-turn.
- **E4 — Fixed chains blind to previous results**: if reproduce already confirmed the cause, the full chain runs anyway (80 min to rediscover the obvious).
- **E5 — Single flat timeout (20 min) without liveness** (spawn.ts:20): healthy QA and a stuck process are indistinguishable until kill; the kill path discards the partial transcript (spawn.ts:341) and `ok: Boolean(rawOutput)` (spawn.ts:365) can mask incomplete output as "completed".

### 0.3 Non-negotiable
Do not touch the CONSTRUCTION of the subagent invocation: `resolvePiInvocation`, the CLI arguments (`pi --mode json -p --no-session --model --tools --append-system-prompt`) and agent frontmatter remain untouched. Timeout, liveness, incompleteness flags and budget INSIDE `spawn.ts` ARE modifiable (STEP 5). What gets fixed is WHAT is injected and HOW the chain is orchestrated.

### 0.4 Security & trust boundaries
- Everything INJECTED into prompts (`{goal}`, skill digests, subagent output, HANDOFF) is UNTRUSTED INPUT: it comes from the user or from the analyzed repo's content.
- **Skip anti-spoofing invariants (STEP 4, all mandatory):** validate-only collapse triggers ONLY if (a) the marker appears inside the structured `## HANDOFF` section, (b) every cited file exists on disk relative to `cwd`, (c) the validate step is ALWAYS executed and cannot be compressed. A marker present in repo content but outside (a)/(b) produces no collapse.
- Concrete note: this very document historically contained the literal marker string — a repo documenting its own processes can plant it in its files.
- The "trust the HANDOFF" directive (STEP 2e) is balanced: VERIFIED FACTS are context, not proof; load-bearing claims justifying code changes MUST always be re-verified.
- `$`-safe interpolation everywhere (STEP 2c): external text must never be able to alter task structure.

### 0.5 Language policy — 100% English
- **ALL runtime content of the extension is in ENGLISH**: tasks and contracts (DELIVERABLE / STOP CONDITION / OUTPUT CONTRACT / HANDOFF), main-phase instructions, chains in `workflows.ts`, digests in `skills-distilled/*.md` (including the new `gstack-fix-strategy.md`), directives in HOME agent files, workflow `notify`/`setStatus` messages, commit messages.
- **Rationale:** a single language in prompts minimizes hallucination probability (language mixing, structural calques) and maximizes model performance on technical instructions.
- **Verified starting state (2026-08-23):** `orchestrator/`, `workflows.ts` and `skills-distilled/` are already 100% English; no Italian accented characters present; HOME agent files clean. The risk is therefore FORWARD-looking: every string destined for a prompt must be written directly in English; no foreign-language formulation may ever leak into runtime content.
- **Automatic guard (language audit test, introduced at STEP 1 and re-run at every step):** unit test collecting all injectable strings — the `tasks` record of `buildAgentTask()`, templates of `buildMainInstructions()`, chain tasks in `workflows.ts`, digests resolved by `REGISTRY` (skills.ts:44), directives documented in `AGENTS_NOTES.md` — and FAILING if it contains entries from an Italian stoplist (e.g. "fase", "trova", "leggi", "scrivi", "deve", "sempre", "perché", "delle", "degli", "questo") or accented letters `[àèéìòù]`. Expected false positives: zero on the current corpus (verified English).

---

## 1. Rules for the executor agent

1. Work on `feat/skill-ingestion` in `C:\Users\Mattia\.pi\agent\extensions\gstack-pi`. One commit per step. NEVER mix steps.
2. After EVERY step: `bun test test/orchestrator.test.ts` → all green (starts at 54). Then bundle check: `bun build orchestrator/index.ts --target node --outdir .tmp-check` (delete `.tmp-check` afterwards).
3. All decision logic goes into pure modules with unit tests (`skip.ts`, `handoff.ts`, `text.ts`). `executor.ts`/`spawn.ts` only orchestrate.
4. Windows/PowerShell environment; git LF/CRLF warnings harmless.
5. All `file:line` references in this document refer to the repo state as of 2026-08-23.
6. Agent definitions live OUTSIDE the repo: `C:\Users\Mattia\.pi\agent\agents\{scout,planner,worker,reviewer}.md`. Every change to those files must be MIRRORED in `AGENTS_NOTES.md` inside the repo (with a verification test — STEP 2e).
7. **Language:** every produced artifact (templates, contracts, digests, agent directives, commit messages) is in ENGLISH — see §0.5.

---

## STEP 0 — Baseline telemetry

**Files:** `orchestrator/spawn.ts`, `orchestrator/executor.ts`

1. At workflow end, persist `.gstack/runs/<ISO-timestamp>-<workflowId>.json` with, for EVERY delegated step: `{ phaseId, stepIndex, agent, durationMs, toolCalls, turns, tokensIn, tokensCacheRead, tokensOut, handoffLevel, incomplete, timedOut, timeoutClass }`. The data already exists in `SpawnResult.usage` (aggregated at spawn.ts:263-281): persistence only, no new measurement.
2. Best-effort writing (try/catch: never fail the workflow over a log).
3. **Baseline:** BEFORE implementing STEPS 1-6, run ≥3 cycles of `/gstack investigate` on the trial repo and store the reports. The final comparison will be minutes AND tokens, not wall-clock only.
4. **New tests:** stable report schema; write happens after a simulated run.

**Commit:** `feat(orchestration): structured run-report telemetry`

---

## STEP 1 — Deliverable-first task contracts [fixes E3]

**Files:** `orchestrator/templates.ts`, `orchestrator/workflows.ts`

Contracts apply across THREE real paths (v3 assumed a single record):
1. `buildAgentTask().tasks` (templates.ts:297): explore, implement, qa, review, ship, fix, test, push-pr, diff, document + **new key `update-docs`** (the ship workflow's real id, workflows.ts:228; currently falls through to the generic fallback at templates.ts:311 — a pre-existing bug silently inherited).
2. `buildMainInstructions().templates` (templates.ts:157): reproduce, verify, setup, report, pre-checks, findings, understand, plan.
3. Inline chains in `workflows.ts`: root-cause (workflows.ts:100-103) — the only existing chain.

### 1a. Fixed 4-block order for every subagent task

```text
## DELIVERABLE
<falsifiable: looking at the output one can say yes/no>

## STOP CONDITION
<Stop when: <observable condition>. Further exploration is waste.>

## CONTEXT
{goal} | branch {branch} | previous phases (compressed) | {previous}

## METHODOLOGY
[skill blocks with class prefix — see 1c]
```

For chain tasks (path 3), the DELIVERABLE/STOP CONDITION blocks go directly into the `task` strings in `workflows.ts`, so both modes (deterministic and advisory) see them. For main phases (path 2), DELIVERABLE/STOP CONDITION go into the corresponding instructions.

### 1b. Minimum contents per phase — falsifiable STOP CONDITIONS

| phase.id | DELIVERABLE | STOP CONDITION |
|---|---|---|
| explore | relevant files+lines (absolute path + line), architectural patterns, constraints, test infra | every area of the goal has ≥1 mapped file; patterns and constraints listed |
| reproduce | deterministic bug trigger + expected vs actual symptoms + trailing line `CONFIRMED ROOT CAUSE: ... \| files: ...` or `none` (see STEP 4) | bug reproduced AND cause verified against code (≤3 targeted reads), or reliable reproduction without cause |
| implement | code per `{plan_file}`, justified deviations, tests run | plan implemented, tests green |
| qa | for each goal-related flow: pass/fail + screenshot + severity CRITICAL/HIGH/MEDIUM/LOW + line `COVERAGE: <tested flows>` | required flows covered OR 2 passes without new findings (deliverable flows ALWAYS mandatory) |
| review | findings with severity + file:line + scope-check + verdict APPROVE/REQUEST_CHANGES | full diff analyzed |
| ship | push, PR URL, updated TODOS.md, verified atomic commits | checklist completed |
| fix | minimal fixes applied, tests green, regression for CRITICAL/HIGH | all findings addressed |
| test | commands identified + pass/fail + failure details | suite completed |
| push-pr | PR URL + CI status | PR created |
| diff | files changed, +/-, summary per area | full analysis |

(Main phases without an explicit row — verify, setup, report, findings — receive DELIVERABLE/STOP CONDITION drafted in the same style, falsifiable.)

### 1c. Skill classes and prefixes
Mapping in templates.ts:
`gstack-qa, gstack-review, gstack-investigate, grilling, gstack-document-generate → "format-critical"`;
`gstack-ship, gstack-office-hours, gstack-plan-eng-review, gstack-document-release → "support"`.

In `buildTaskSkills()` per-digest prefix:
- format-critical: `"This methodology's output format IS part of the deliverable: severity categories, gates and report structures are MANDATORY."`
- support: `"Apply the parts useful to the deliverable; nothing more."`

**New cross-cutting tests:** iterate `getAllWorkflows()` × every phase × path (tasks map / chain / main instructions) and assert presence of `DELIVERABLE` and `STOP CONDITION` in the final product — the test also catches future lost ids. Plus: correct strong/weak prefix per class. Plus the **language audit** (§0.5): Italian stoplist + accented letters over all injectable strings, digests included.

**Commit:** `fix(injection): deliverable-first contracts across all instruction paths [E3]`

---

## STEP 2 — HANDOFF protocol + safe interpolation + resilience [fixes E2]

### 2a. Output contract in tasks
Append to EVERY subagent template (after METHODOLOGY):

```text
## OUTPUT CONTRACT
1. "## REPORT" — the full report in your role's format.
2. "## HANDOFF" (mandatory, ≤300 words, for the next specialist):
   - VERIFIED FACTS: confirmed facts only, each with evidence `claim @ file:line`
   - DECISIONS: choices made and why (one line each)
   - OPEN QUESTIONS: what remains open (or "none")
   - DO NOT REDO: what the next agent must NOT redo
```

### 2b. New module `orchestrator/handoff.ts` (pure)

```ts
export type HandoffLevel = "full" | "partial" | "raw" | "fallback";
export function extractHandoff(
  output: string,
  opts?: { incomplete?: boolean },
): { text: string; level: HandoffLevel };
```

Rules in order:
1. `incomplete === true` → level capped at `"fallback"` (output unreliable as complete).
2. output absent/empty → `{ text: "(previous step failed)", level: "raw" }`
3. output ≤ 6000 characters → whole, `"raw"`
4. last `## HANDOFF` section present, contains `VERIFIED FACTS`, ≤ 4000 chars → that, `"full"`
5. section present but incomplete/malformed and ≤ 4000 chars → that, `"partial"`
6. otherwise → last 12000 chars cut at a paragraph boundary, `"fallback"`

### 2c. `executor.ts` + `templates.ts` — correct wiring
- Replace the `PREVIOUS_CAP` block (executor.ts:183-188) with `extractHandoff()`.
- **`$`-safe interpolation:** new module `orchestrator/text.ts`:

  ```ts
  export function replaceExact(t: string, token: RegExp, value: string): string {
    return t.replace(token, () => value);
  }
  ```

  Use it for `{previous}` (executor.ts:188) AND for all replacements in `interpolate()` (templates.ts:374-380: `{goal}`, `{branch}`, `{plan_file}`, `{*_summary}`). Reason: with a string argument, `$&`, `` $` ``, `$'`, `$1` in scout output or the user goal silently corrupt the task. (Census: same bug class at `agent/extensions/subagent/index.ts:536` — separate extension, OUT of scope, record in FUTURE_UPDATES.)
- **Extract before cap:** `extractHandoff()` runs on RAW output; the 50KB cap (spawn.ts:21) only applies to what reaches the orchestrator. Extracting after the cap systematically loses `## HANDOFF` (trailing the REPORT) on long reports.
- Level in the delegation summary: `### Subagent: <name> — completed (Ns · N tool calls · N turns · Ns/turn · handoff: <level>)` with `, output INCOMPLETE (<cause>)` when `incomplete`.

### 2d. `spawn.ts` — incompleteness flag
`SpawnResult` gains `incomplete?: boolean` = true on: timedOut, aborted, exit≠0 with partial output. On kill/timeout PRESERVE the collected partial transcript instead of discarding it (today spawn.ts:341 `aborted ? "" : …`): labeled partial output > absent output. Pass `incomplete` to `extractHandoff`.
### 2e. Directives in agent files (HOME, outside repo) + verified mirror
In `~/.pi/agent/agents/planner.md`, after the cooperation paragraph:
`"You receive VERIFIED FACTS from a prior specialist. Treat them as context, not proof: do NOT re-verify systematically, but ALWAYS re-check claims that are load-bearing for code changes you are about to make."`
In `worker.md`: `"Trust the HANDOFF section of the task as working context; re-check only claims that are load-bearing for edits you are about to make."`
Both mirrored into `AGENTS_NOTES.md` (new file in repo root) with home-file paths.
**Anti-drift test:** unit test reading the two home files and asserting presence of the directives documented in AGENTS_NOTES.md.

### 2f. Sequential-chain resilience
In `runDeterministicDelegation` (executor.ts:169): retry-once after 30s for TRANSIENT failures (timedOut, aborted, exit≠0 without output); on retry the timeout limit is raised by +50%; HARD failure (config, missing agent) → propagate immediately.

### 2g. Optional phases in deterministic mode
Today `ctx.ui.confirm` (executor.ts:106-122) also runs inside fire-and-forget `launchPhase`: on stale ctx the chain is abandoned SILENTLY (lines 113-114). Fixes:
- catch → record `skipped` in state + notify; NEVER a silent return;
- new flag `GSTACK_PI_OPTIONAL_PHASES=ask|auto|skip` (default `ask` = current behavior; `auto`/`skip` avoid the prompt in background).

**Scope note:** with `GSTACK_PI_DETERMINISTIC=off`, tasks go through `buildSubagentInstructions()` (templates.ts:260) where `{previous}` stays literal and `extractHandoff` is never invoked: the HANDOFF/skip protocols hold in deterministic mode; document this in README (STEP 6) and cover advisory behavior with a documentation test.

**New tests:** handoff levels (full/partial/raw≤6K/fallback>12K/empty/incomplete); invariant text ≤4000 when full; replaceExact + interpolate() with `$&, $', $1` payloads; AGENTS_NOTES mirror test; retry transient yes / hard no (mock runSubagent); optional-phase stale → recorded skipped.

**Commit:** `fix(injection): structured HANDOFF, safe interpolation, incomplete flags, resilient chains [E2]`

---

## STEP 3 — Selective skill per chain step [fixes E1]

**Files:** `orchestrator/types.ts`, `orchestrator/workflows.ts`, `orchestrator/templates.ts`, `skills-distilled/`

### 3a. `types.ts`
The chain-step type (inside `WorkflowPhase["chain"]`) gains an optional field:
`skills?: string[]` — default: inherits `phase.skills` (backwards compatible).

### 3b. `workflows.ts` — annotations
root-cause chain (investigate):
- scout → `skills: ["gstack-investigate"]`;
- planner → `skills: ["gstack-fix-strategy"]` (dedicated short digest, see 3d — no longer v3's excerpt mechanism).

### 3c. `templates.ts`
Signature: `buildTaskSkills(phase, task, skillsOverride?: string[])`.
In `buildDeterministicPlan()` and `buildSubagentInstructions()` pass `step.skills ?? phase.skills`.

### 3d. Vendored skill `gstack-fix-strategy` (rewritten)
v3 assumed an existing "fix-strategy section" in the gstack-investigate digest: it DOES NOT exist (actual headings: Iron Law, Phase 1—Root Cause Investigation, Phase 2—Pattern Analysis, Phase 3—Hypothesis Testing, Phase 4—Minimal Fix, Phase 5—Verification & Report, Hard rules; ~2.2KB total). HTML markers + `getDigestExcerpt()` were also disproportionate (~600 chars saved on a single chain). Instead:
1. Create `skills-distilled/gstack-fix-strategy.md`: a <800-char digest derived from "Phase 4 — Minimal Fix", same format as the other digests.
2. Register it in `REGISTRY` (skills.ts:44) as a vendored skill (no upstream SKILL.md).
3. No HTML markers, no extractor: the planner receives a normal METHODOLOGY block via `buildTaskSkills` with the 3b/3c override.

Effect: ~40% less complexity than v3; E1 benefit intact (planner without the full investigation methodology).

**New tests:** root-cause chain → scout contains the full `## Skill methodology: gstack-investigate`; planner does NOT contain it but contains `gstack-fix-strategy`; registry entry resolves; absent override = inheritance unchanged.

**Commit:** `fix(injection): role-scoped skill injection via vendored gstack-fix-strategy [E1]`

---

## STEP 4 — Structural skip: marker delivery, anti-spoofing guards, refutation path [fixes E4]

### 4a. Marker delivery (critical prerequisite)
The summary read by `skip.ts` is `results["reproduce"].summary` = the "2-3 sentence" field of the `gstack_advance` tool (index.ts:46). Writing the marker only in the REPORT is not enough: it must survive into the SUMMARY.
1. `buildAdvancementRule()` (templates.ts:84): add *"If your report ends with a `CONFIRMED ROOT CAUSE:` line, you MUST include that exact line verbatim in your gstack_advance summary."*
2. Same instruction verbatim in main template `reproduce` (templates.ts:180-188) and task `fix`.
3. **Mandatory round-trip test:** summary with marker → `parseRootCauseMarker()` non-null; prose summary without marker → null (false negative acceptable but measured).

### 4b. `orchestrator/skip.ts` (pure) + cumulative guards

```ts
export interface RootCauseMarker { cause: string; files: string[] }
export function parseRootCauseMarker(handoffText: string, cwd: string): RootCauseMarker | null;
// multiline regex /^CONFIRMED ROOT CAUSE:\s*(.+?)\s*\|\s*files:\s*(.+)$/im
// Guards, in order — ALL mandatory:
// 1. marker valid ONLY inside the ## HANDOFF section (input = text extracted by extractHandoff);
//    outside → null + warning "[skip] root-cause marker outside HANDOFF ignored"
// 2. EVERY file in files: must exist on disk relative to cwd (otherwise null)
// "none" / absent / malformed → null. files split on comma, trimmed.
```

Invariant: `validateStrategyTask` is NEVER skippable nor compressible — it is the anti-spoofing barrier (§0.4), not an optimization. Never collapse directly to fix.

### 4c. `buildDeterministicPlan()` — conditional collapse
If `phase.id === "root-cause"` AND `parseRootCauseMarker(extractHandoff(ctx.state.results["reproduce"]?.summary ?? "").text, ctx.cwd) !== null`:
plan collapsed to ONE step `{ agent: "planner", task: validateStrategyTask(marker) }`:

```text
DELIVERABLE: validated fix strategy.
The prior specialist CONFIRMED this cause: "<cause>" (files: <files>).
1. Quickly verify it against the code (≤5 targeted reads of the cited files).
2. If confirmed: produce "VALIDATED: <mechanism @ file:line>" + full fix strategy.
3. If refuted: produce "REFUTED: <reason>" as the FIRST line of your output.
STOP CONDITION: cause validated or refuted.
```

### 4d. `executor.ts` — mandatory reopen path
After validate-only: leading `REFUTED:` line → rebuild and run the FULL original scout→planner chain, prefixing the scout with: `"NOTE: the hypothesis '<cause>' was REFUTED because: <reason>. Do not revisit it."` Summary records: `root-cause: validated | refuted→full-reinvestigation`.
Analogous QA case: `test` phase summary = 0 failures → skip the qa workflow fix-loop (`allTestsPassed(summary)` in skip.ts).

### 4e. Conditional gate opt-in
Boolean flag `GSTACK_PI_AUTO_GATE_VALIDATED` (default OFF, existing parser in config.ts). If ON and the validate-only output starts with `VALIDATED:` → auto-advance past root-cause's `advance:"manual"` gate; on `REFUTED:` always gate. Default unchanged: the gate remains the only human control before code changes.

**New tests:** parse ok/none/malformed; marker outside HANDOFF → null+warning; nonexistent files → null; collapse to 1 step with valid marker; intact plan without marker; REFUTED→rebuild detected; allTestsPassed true/false/malformed; opt-in gate on/off.

**Commit:** `feat(orchestration): structural skip with delivery guarantees and anti-spoofing guards [E4]`

---

## STEP 5 — Adaptive timeouts, observable liveness, token budget [fixes E5]

### 5a. `config.ts` — numeric parser + timeout per class
`config.ts` today parses booleans only. Add:

```ts
export function numberEnv(
  name: string,
  defaultValue: number,
  opts?: { min?: number; allowOff?: boolean },
): number | "off";
```

invalid values → default + single warn; `"off"` sentinel only with `allowOff`.
Per-class timeouts, ALL in SECONDS (fallback = historical 1200s value, NOT raised — spawn.ts:20 `DEFAULT_TIMEOUT_MS = 20*60*1000`; v3's ambiguous "(2000)" is abolished):
- `GSTACK_PI_TIMEOUT_EXPLORE=900` (480 discouraged: the historical scout does 20-40 tool calls; only STEP 0 baseline data can justify it)
- `GSTACK_PI_TIMEOUT_WORK=1500`
- `GSTACK_PI_TIMEOUT_VERIFY=900`
- fallback: `GSTACK_PI_SUBAGENT_TIMEOUT` (default 1200)

`export function subagentTimeoutFor(phaseId: string): number` with an EXHAUSTIVE map over the real ids of `getAllWorkflows()`:
explore→EXPLORE; implement, qa, regression-qa, fix→WORK; review, test, verify, push-pr, ship, diff, document, update-docs→VERIFY.
Wiring: `SpawnRequest` gains `phaseId?: string`; the executor passes `phase.id`; `spawn.ts` uses `req.phaseId ? subagentTimeoutFor(req.phaseId) : defaultTimeoutMs()`.
Anti-rigging: "zero WORK kills" in the acceptance criteria holds ONLY if limits were not raised vs the historical values unless baseline evidence says otherwise.

### 5b. Observe-only liveness with a defined sink
In the existing 1 Hz poll (spawn.ts:315): track the gap between JSON events. Gap > `GSTACK_PI_LIVENESS_SEC` (default 240, `off` to disable):
- do NOT terminate the process;
- DUAL sink: best-effort `ctx.ui.notify` (stale guard), ONCE per run: `[liveness-observe] would abort '<agent>' after <gap>s of silence (last event: <type>, tool: <name>)` + recording in the JSON run-report (STEP 0) of gap, last event, running tool. Without these data a future kill decision is impossible (gaps >240s are normal during long builds/tests: false positives indistinguishable from real hangs).
Activating the real kill is FORBIDDEN in this plan: it requires data from ≥2 real runs (§Validation).

### 5c. Token budget circuit-breaker
`GSTACK_PI_MAX_RUN_TOKENS` (numberEnv, no default = disabled): cumulative token sum per workflow from `usage` already aggregated at spawn.ts:263-281; threshold exceeded → notify + orderly chain stop (state recorded, no abrupt kill).

### 5d. Parallel waves: REMOVED from the plan (→ FUTURE_UPDATES)
The entities cited by v3 do not exist (qa: setup/test/report/fix — no "diff-analysis"; ship: pre-checks/review/test/push-pr/verify/update-docs — no "coverage-audit"/"changelog-check"); `after/exclusive` were proposed on chain-steps but the flagship cases were distinct PHASES of the sequential state machine; the only real chain (root-cause) must stay sequential. Building waves.ts now means infrastructure that parallelizes nothing. Requirements for the future design (to record in FUTURE_UPDATES at STEP 6):
- parallelism at `WorkflowPhase` level (extends after/exclusive to phase types; touches `state.ts`);
- `{previous}` semantics in wave mode: concat of the handoffs of the steps in `after`, in declared order;
- mechanized `exclusive` guard: test reading `tools:` from agent frontmatter (`~/.pi/agent/agents/*.md`) validating that a wave never mixes conflicting tools (git-write, ports/dev-servers, shared `.gstack`); manual annotation as override only;
- gate handling (`advance:"manual"`) during waves; result merge in `formatDelegationResults`; concurrency `GSTACK_PI_MAX_PARALLEL` (uses the 5a numberEnv).

**New tests:** exhaustive mapping (for every phase of every workflow, `subagentTimeoutFor(phase.id)` ∈ known classes, no implicit fallback fallthrough); numeric config (default/override/off/invalid); liveness produces notify+record and does not terminate; token circuit-breaker.

**Commit:** `feat(orchestration): adaptive timeouts, observable liveness, token budget [E5; waves deferred]`

---

## STEP 6 — Documentation
1. `README.md` — "Injection & efficiency": task contracts (three paths), HANDOFF protocol, marker delivery + guards, per-class timeouts, complete new env variables (`GSTACK_PI_TIMEOUT_*`, `GSTACK_PI_LIVENESS_SEC`, `GSTACK_PI_MAX_RUN_TOKENS`, `GSTACK_PI_OPTIONAL_PHASES`, `GSTACK_PI_AUTO_GATE_VALIDATED`); SCOPE: protocols valid in deterministic mode (documented advisory divergence).
2. `README.md` — "Security & trust boundaries": injection threat model (§0.4), anti-spoofing invariants.
3. `FUTURE_UPDATES.md` — phase-level parallel waves (requirements 5d); liveness kill activation (post-data, ≥2 real runs); per-step checkpoint + `WorkflowState` versioning (paired: the checkpoint enables post-reload resume without redoing scout and forces versioning of the persisted schema); `{previous}` fix in `agent/extensions/subagent/index.ts:536`; skip extension to other workflows.
4. `AGENTS_NOTES.md` — complete required state of home files (created at STEP 2e).

**Commit:** `docs: injection correctness behavior, security boundaries and configuration`

---

## VALIDATION (only AFTER all STEPS 0-6 are committed)

1. `bun test test/orchestrator.test.ts` — all green (≥80 tests expected).
2. Bundle: `bun build orchestrator/index.ts --target node --outdir .tmp-check` clean; remove `.tmp-check`.
3. Run ≥3 real `/gstack investigate` cycles on the trial repo (n=1 is anecdotal).
4. Acceptance criteria (readable from delegation summaries and run-reports):
   - root-cause with valid marker (in HANDOFF, existing files): 1-step plan, duration < 10 min
   - handoff level visible for every step (full/partial/raw/fallback)
   - no task without DELIVERABLE/STOP CONDITION on any of the three paths (cross-cutting test green)
   - root-cause planner WITHOUT the full investigation digest, WITH gstack-fix-strategy
   - zero `ok:true` with `incomplete=true` unlabeled in the delegation summary
   - handoff computed on uncapped output: at least one run with a >50KB report shows correct full/partial
   - every phase of every workflow resolves to a known timeout class
   - language audit green: zero non-English content in injectable strings (§0.5)
   - zero kills on WORK phases without raised limits unless baseline evidence
   - liveness logs/records consistently present or absent (no kills)
5. Compare against the STEP 0 baseline on minutes AND token/cost deltas (indicative target ≤60 min vs ~150 historical minutes; the token figure is the demonstrative one for E1/E2).
6. Report the collected run-reports: they will feed the future liveness-kill decision (out of scope here).

## ROLLBACK

Each STEP is an atomic commit with its own tests: `git revert <sha>` restores prior behavior without touching the others. Existing flags (`GSTACK_PI_SKILLS/DETERMINISTIC/MANUAL_GATES`) and new ones (`GSTACK_PI_AUTO_GATE_VALIDATED`, `GSTACK_PI_OPTIONAL_PHASES`, timeout/liveness/budget env) disable entire subsystems. STEP 0 (telemetry) is additive and revert-safe.

---

## Appendix A — Correction traceability

| ID | Topic | Applied in |
|---|---|---|
| COR-01 | Marker delivery to skip.ts | STEP 4a |
| COR-02 | Skip anti-spoofing guards | §0.4, STEP 4b |
| COR-03 | Vendored gstack-fix-strategy | STEP 3d |
| COR-04 | Three-path contracts + update-docs | STEP 1 |
| COR-05 | Waves removed → FUTURE_UPDATES | STEP 5d, STEP 6.3 |
| COR-06 | Timeouts: units/map/wiring/anti-rigging | STEP 5a |
| COR-07 | Systemic $-safe replaceExact | STEP 2c |
| COR-08 | Incomplete flag on SpawnResult | STEP 2b/2d |
| COR-09 | Extract HANDOFF before cap | STEP 2c |
| COR-10 | Numeric config parser | STEP 5a |
| COR-11 | Documented advisory divergence | STEP 2 note, STEP 6.1 |
| COR-12 | Liveness sink + data quality | STEP 5b |
| COR-13 | Mechanized exclusive via frontmatter | STEP 5d (FUTURE_UPDATES) |
| COR-14 | Sequential chain retry | STEP 2f |
| COR-15 | Run-report JSON + baseline ≥3 | STEP 0, VALIDATION |
| COR-16 | AGENTS_NOTES anti-drift test | STEP 2e |
| COR-17 | Opt-in conditional gate | STEP 4e |
| COR-18 | Falsifiable STOP CONDITIONS | STEP 1b |
| COR-19 | §0.3 reformulated | §0.3 |
| COR-20 | Security docs | §0.4, STEP 6.2 |
| COR-21 | Optional phases in background | STEP 2g |
| COR-22 | Token circuit-breaker | STEP 5c |
| LANG-01 | 100% English policy + language audit | §0.5, rule 7 §1, STEP 1 test, VALIDATION |
