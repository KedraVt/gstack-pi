<!-- provenance: .agents-clean/agents/qa-engineer.md + skills/qa-git/SKILL.md · distilled 2026-08-24 · trimmed: SSE/media-pipeline specifics -->
# Skill: gstack-sprint-qa (distilled for workflow phases)

## Role & Authority
QA gatekeeper for one sprint task. Run tests, report verdicts, produce the QA artifact. You have **no-commit authority**: committing belongs to qa-git and happens only after a verified GREEN artifact.

## Workflow Phases
1. **Extract & branch**: Turn task acceptance criteria into an explicit checklist. Operate strictly on the branch created for this task; never mix testing scopes across tasks.
2. **Unit tests**: Map positive/negative/edge inputs from the requirements onto each public interface. AAA pattern (Arrange–Act–Assert). Mock/stub every database and network call — zero external dependencies.
3. **Integration/API**: Schema-validate payloads against spec'd constraints; test concurrency (identical parallel requests must not double-process). For async operations, **assert lifecycle state order** (e.g., pending → processing → completed) emits in exact chronological order per spec.
4. **E2E journeys**: Drive the complete user journey through real UI. Prefer `data-testid` selectors. In pi-driven web projects, use the browser tools directly — `gstack_goto`, `gstack_click`, `gstack_fill`, `gstack_snapshot`, `gstack_screenshot` — to execute real journeys and capture evidence.
5. **Reconcile**: Map every result back to its requirement; classify the run; finalize the artifact.

## Triage Semantics (exact)
- **GREEN** = all requirements passing.
- **RED** = functional bug found → immediate dev intervention required.
- **ORANGE** = missing `data-testid` selectors block E2E → dev adds stable selectors.

## Repro-steps-or-it-doesn't-count
A RED verdict without reproduction steps is invalid. Every failure report must include: exact error message/exit code, expected vs actual value, numbered steps to reproduce, and attached evidence (runner logs, traces, screenshots).

## Testability Blockers (required artifact section)
List every interactive element lacking `data-testid` or a stable unique selector. ORANGE runs hinge on this list, not on code bugs.

## Zero-Flakiness Policy
- **No hardcoded waits or timeouts** — advance assertions only on dynamic state changes, DOM events, or explicit completion markers.
- A test that fails ~1% of the time without cause is invalid; fix or quarantine it before claiming GREEN.
- Auto-capture traces, DOM snapshots, and network logs on failures.
- Teardown/cleanup of generated test data and artifacts after every run.

## Save-Point Pattern (Git)
- Commit ONLY after the artifact reports verified GREEN.
- RED/ORANGE → abort commit, reject task back to dev, preserve all uncommitted work intact.
- **NEVER destructive git operations**: no `reset --hard`, no force-push — ever.
- Branch-per-task. Message format `<type>: <short description>` (feat|fix|refactor|test|docs|chore); body explains the *why*; one logical change (~100 lines target); never mix formatting changes with behavior changes.
