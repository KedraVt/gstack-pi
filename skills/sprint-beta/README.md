# sprint-beta — unified skill catalog

Self-contained, deduplicated catalog merging the gstack skill set (23 SKILL.md,
vendored `grilling` + `gstack-fix-strategy`) with the Kedra skill set (18
SKILL.md). Purpose: single source of truth for the sprint cycle, used by default for
full-skill injection (`GSTACK_PI_SKILL_INJECTION=full`). Set
`GSTACK_PI_SKILL_INJECTION=digest` to use the legacy distilled sources while
comparing behavior.

## Naming conventions

- **Fused skills** (2+ sources unified): `beta-` prefix.
- **Whole skills** (carried over verbatim, directory included): original name.
  pi requires frontmatter `name` == parent directory name, so folder names are
  the original frontmatter names (`gstack-*` for gstack skills, unprefixed for
  Kedra ones). Note: whole Kedra copies duplicate names already present under
  `skills/kedra/` — benign until the migration completes; remove `kedra/` (or
  exclude it from `pi.skills`) when sprint-beta becomes canonical.
- **Materialized** (were digest-only vendored protocols, no upstream SKILL.md):
  now first-class SKILL.md with frontmatter.

## Merge map (10 sources → 5 fused skills)

| Fused skill | Sources | Who wins on what |
|---|---|---|
| `beta-debugging` | `gstack-investigate` + `systematic-debugging` | gstack: 5-phase skeleton, scope lock, blast radius, DEBUG REPORT. Kedra: Iron Law framing, red flags, rationalization table, architecture-questioning escalation. |
| `beta-code-review` | `gstack-review` + `code-audit-reviewer` | gstack: scope drift, plan-completion audit, confidence calibration, pre-emit quote gate. Kedra: 5 dimensions, severity classes, artifact/verdict protocol. |
| `beta-qa` | `gstack-qa` + `gstack-qa-only` + `qa-git` (triage) | gstack: browser methodology, tiers, fix mode. qa-only: report-only mode. Kedra: GREEN/RED/ORANGE triage, Testability Blockers, zero-flakiness, artifact dual-channel. |
| `beta-security` | `gstack-cso` + `appsec-hardening` | Kedra: three-tier boundary system, STRIDE/threat model, artifact protocol, LLM governance. gstack: stack detection, attack-surface census, false-positive verification phases. |
| `beta-ship` | `gstack-ship` + `qa-git` (Save-Point) | gstack: pre-flight → tests → version → CHANGELOG → TODOS → push/PR, SHIP REPORT. Kedra: Save-Point Pattern (commit only after GREEN, never destructive git, branch-per-task, Conventional Commits). |

Principle: **artifact/protocols win from Kedra, interactive/mechanics win from
gstack.** All orchestrator-owned harness behavior (advancement, AskUserQuestion
preambles, telemetry, learnings binaries, plan-mode gates) is NOT carried into
fused skills — the workflow orchestrator owns it.

## Provenance — whole copies (32)

- gstack verbatim (16): `gstack-office-hours`, `gstack-plan-eng-review`,
  `gstack-plan-ceo-review`, `gstack-plan-design-review`, `gstack-plan-devex-review`,
  `gstack-document-generate`, `gstack-document-release`, `gstack-design-review`,
  `gstack-autoplan`, `gstack-retro`, `gstack-learn`, `gstack-scrape`,
  `gstack-skillify`, `gstack-spec`, `gstack-context-save`, `gstack-context-restore`
- Kedra verbatim (14): `product-capability`, `system-design`, `adr`, `tasks`,
  `test-driven-development`, `verification-before-completion`,
  `code-simplification`, `strategic-compact`, `agent-introspection-debugging`,
  `docker-manager`, `pipeline-sre`, `code-tour`, `manim-video`, `add-model`
- Materialized (2): `grilling`, `gstack-fix-strategy`
- Excluded: the `gstack` router skill (pi-adapter infrastructure, not methodology)

Sync safety: `scripts/sync-skills.ts` writes only into `skills/gstack/` with a
closed INCLUDE list — sprint-beta is never touched by sync.

## Selection table — deterministic injection vs invocable (DECIDED)

Injection = METHODOLOGY block in the specialist's task (subagents) or full
methodology in the main phase context (first delivery only; repeats degrade to
the DoD gate). Invocable = reachable via the skill index, never injected.

| Skill | Inject | Invocable | Target phase / rationale |
|---|---|---|---|
| beta-qa | ☑ | — | qa-verdict (qa-engineer), mode pinned report-only |
| beta-code-review | ☑ | — | devsecops-review (reviewer) |
| beta-security | ☑ | — | devsecops-review (devsecops-reviewer) |
| beta-ship | ☑ | — | commit-archive ONLY (commit/push authority; manual gate) |
| beta-debugging | ☑ | — | investigate cycle (reproduce/root-cause/fix); never sprint roles |
| grilling | ☑ post-merge | ☑ today | main `understand` after the develop→sprint merge; never subagents |
| gstack-fix-strategy | ☑ | — | investigate root-cause chain (VALIDATED/REFUTED parsing) |
| product-capability | ☑ | — | user-story + capability (main) |
| system-design | ☑ | — | system-design (main) + architect-gate digest |
| adr | ☑ | — | system-design (main) |
| tasks | ☑ | — | backlog (main) |
| test-driven-development | ☑ | — | implement chain (BE→FE) |
| verification-before-completion | ☑ | — | implement chain + commit-archive DoD repeat |
| docker-manager | ☑ conditional | — | devsecops-review, only when repo has Docker |
| pipeline-sre | ☑ conditional | — | devsecops-review, only when repo has CI |
| gstack-plan-eng-review | ☑ (needs preamble extraction) | ☑ today | architect-gate after extraction (~1049 r. → ~300 clean) |
| gstack-office-hours | post-merge (needs preamble extraction) | ☑ today | main `understand` after merge; 1669 r. with harness preamble |
| gstack-document-release | ☑ post-merge | ☑ today | future sprint `document` phase (962 r. with preamble) |
| gstack-document-generate | ☑ post-merge | ☑ today | future sprint `document` phase (1249 r. with preamble) |
| code-simplification | — | ☑ | deviates: "refactor for clarity" inside a minimal-diff loop = scope creep; future optional post-GREEN step |
| strategic-compact | — | ☑ | deviates: suppresses `## HANDOFF` → breaks chain handoff + verdict parsing; needs HANDOFF-compatible rewrite first |
| agent-introspection-debugging | — | ☑ | deviates: self-diagnosis belongs to the orchestrator retry logic, never to role agents mid-phase |
| gstack-spec | — | ☑ | deviates: the planning chain (capability→system-design→adr→tasks) is canonical in sprint |
| (out-of-lifecycle: design-review, retro, plan-ceo/design/devex-review, context-save/restore, scrape, skillify, autoplan, learn, code-tour, manim-video, add-model) | — | ☑ | side-workflows / session bookkeeping / unrelated artifacts — never injected |

Working criteria: inject if format-critical (the format IS the deliverable) or
role-gate (the agent cannot complete the phase without it); keep invocable if a
methodology library consulted on demand, a hijack risk, or outside the critical
path. Deviation taxonomy: contract conflict (strategic-compact,
agent-introspection-debugging), interaction hijack (grilling/spec/office-hours
in subagents, autoplan), premature authority (beta-ship outside commit-archive,
beta-qa fix mode in the loop), duplication (spec vs planning chain),
boilerplate (whole gstack copies still carrying the ~700-line harness preamble).

## Injection mechanics (IMPLEMENTED)

- `GSTACK_PI_SKILL_INJECTION=full|digest` flag (default `full`; `digest` is the explicit legacy override)
- Registry id → sprint-beta file mapping via `betaFile` (all 20 registry ids map
  to catalog files; see `orchestrator/skills.ts`)
- `loadSkillSource(id, mode)` in `orchestrator/skills.ts`; consumed by
  `buildTaskSkills` and `buildOrchestratorSkillBlock` in `orchestrator/templates.ts`
- `qa-verdict` phase pins `variant: "report-only"` (beta-qa mode pinning)
- Unit tests: `test/beta-injection.test.ts` (in the package test script)
- Default `full` uses sprint-beta; `digest` remains available as an explicit rollback

## Open follow-ups

- strategic-compact: HANDOFF-compatible rewrite before any injection
- gstack-plan-eng-review: methodology extraction (~1049 → ~300 lines) for
  architect-gate injection in full mode
- develop→sprint phase merge (colloquio, explore, document) — grilling,
  office-hours and document-* injections activate after it lands
