# sprint-beta — unified skill catalog

Self-contained, deduplicated catalog merging the gstack skill set (23 SKILL.md,
vendored `grilling` + `gstack-fix-strategy`) with the Kedra skill set (18
SKILL.md). Purpose: single source of truth for the sprint cycle, ready for the
full-skill injection experiment (`GSTACK_PI_SKILL_INJECTION=full`, **deferred to
the next commit**) while remaining pi-invocable as-is.

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

## Selection table — deterministic injection vs invocable (TO FILL, phase 5)

| Skill | Inject deterministically | Invocable | Rationale |
|---|---|---|---|
| beta-qa | ☐ | ☐ | |
| beta-code-review | ☐ | ☐ | |
| beta-debugging | ☐ | ☐ | |
| beta-security | ☐ | ☐ | |
| beta-ship | ☐ | ☐ | |
| grilling | ☐ | ☐ | |
| gstack-fix-strategy | ☐ | ☐ | |
| gstack-office-hours | ☐ | ☐ | |
| gstack-plan-eng-review | ☐ | ☐ | |
| product-capability | ☐ | ☐ | |
| system-design | ☐ | ☐ | |
| adr | ☐ | ☐ | |
| tasks | ☐ | ☐ | |
| test-driven-development | ☐ | ☐ | |
| verification-before-completion | ☐ | ☐ | |
| code-simplification | ☐ | ☐ | |
| strategic-compact | ☐ | ☐ | |
| agent-introspection-debugging | ☐ | ☐ | |
| docker-manager | ☐ | ☐ | |
| pipeline-sre | ☐ | ☐ | |
| gstack-document-release | ☐ | ☐ | |
| gstack-document-generate | ☐ | ☐ | |
| (out-of-lifecycle: design-review, retro, plan-*-review, context-*, scrape, skillify, spec, autoplan, learn, code-tour, manim-video, add-model) | — | ☑ default | richiamabili |

Working criteria: inject if format-critical (the format IS the deliverable) or
role-gate (the agent cannot complete the phase without it); keep invocable if a
methodology library consulted on demand or outside the critical path.

## Next commit (planned, NOT in this one)

- `GSTACK_PI_SKILL_INJECTION=full|digest` flag (default `digest`, today-identical)
- Registry id → sprint-beta file mapping (`gstack-sprint-qa` → `beta-qa`,
  `gstack-review` → `beta-code-review`, `gstack-ship` → `beta-ship`,
  `gstack-investigate` → `beta-debugging`, `gstack-sprint-appsec` → `beta-security`,
  `gstack-sprint-tdd` → `test-driven-development`, …)
- `buildTaskSkills` / `buildOrchestratorSkillBlock` mode-aware source resolution
- Unit test for full-mode resolution; suite must stay green with default `digest`
