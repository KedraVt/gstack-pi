<!-- provenance: .agents-clean/skills/test-driven-development/{SKILL.md,testing-anti-patterns.md} · distilled 2026-08-24 · trimmed: code examples, rationalization table, red-flag list, gate-function blocks, when-stuck table, verbose anti-pattern walkthroughs -->
# Skill: gstack-sprint-tdd (distilled for workflow phases)

## Iron Law
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. Code written before its test gets deleted — implement fresh from tests.

## Red-Green-Refactor Cycle
1. **RED** — One minimal failing test for one behavior; clear name stating it ("retries 3 times", not "retry works"). Real code, mocks only if unavoidable.
2. **Verify RED (mandatory)** — Confirm it *fails* (not errors) for the expected reason: feature missing, not typo. Passes immediately → testing existing behavior; fix the test.
3. **GREEN** — Simplest code that passes; no extra options or drive-by refactors.
4. **Verify GREEN (mandatory)** — All tests pass, output pristine. Failing? Fix code, not test.
5. **REFACTOR** — Only after green: dedupe, rename, extract helpers; stay green, no new behavior.

## Test Structure: AAA
Every test: **Arrange** inputs → **Act** on one thing → **Assert** outcome. "and" in the name → split into two tests.

## Prove-It Pattern (bug fixes)
Reproduce every bug with a failing test before fixing: RED proves you captured it, GREEN proves the fix, the test prevents regression forever. Never fix bugs without a test.

## Coverage
Target **80% coverage for new code**: every function tested, edge cases and errors included. Manual testing ≠ tests — ad-hoc, can't re-run.

## Why Test-First
Tests written after code pass immediately — and passing proves nothing. Tests-after ask "what does this do?"; tests-first ask "what should it do?", finding edge cases before implementation biases you.

## Anti-Patterns (top 10)
1. **Testing mock behavior** — asserting a mock exists verifies nothing about real code.
2. **Test-only methods in production classes** — pollutes API, risky in prod; use test utils.
3. **Mocking without understanding dependencies** — kills a side effect the test needs; run real first, then mock minimally.
4. **Incomplete mocks** — omitted fields = silent downstream failures; mirror the full schema.
5. **Tests as afterthought** — "implementation complete" without tests isn't complete.
6. **Over-complex mocks** — setup longer than logic → use an integration test instead.
7. **Vague test names** (`test1`, "works") — must state the behavior under test.
8. **Multiple behaviors per test** — hides what broke; one per test.
9. **Fixing failures by editing assertions** — the test encodes intent; fix the code.
10. **Mocking "to be safe"** — unneeded mocks decouple tests from reality.

## Rationalization Kill-Switch
"Too simple to test", "tests later", "already manually tested", "TDD slows me down", "just this once" — all mean: delete code, restart with TDD.

## Phase Checklist (before done)
- [ ] Watched each test fail first, for the expected reason
- [ ] Minimal code to pass; all green, pristine output
- [ ] Real code over mocks; ~80% new-code coverage
