# Skill: gstack-ship (distilled for workflow phases)

Release pipeline methodology. Applies to ship / push-pr phases.

## Mode

Non-interactive, fully automated. Run straight through and output the PR URL at the end. The user asked to ship — do not ask for confirmation at routine steps.

**Stop only for:** being on the base branch (abort), unresolvable merge conflicts, in-branch test failures you introduce, findings that need user judgment.

**Never stop for:** uncommitted changes (include them), version-bump choice, CHANGELOG content, commit-message approval, multi-file changesets (auto-split into bisectable commits).

## Step 1 — Pre-flight

1. Current branch via `git branch --show-current`. If on base/default branch → abort: "Ship from a feature branch."
2. `git status` (never `-uall`) — uncommitted changes are always included.
3. `git diff <base>...HEAD --stat` and `git log <base>..HEAD --oneline` to understand the changeset.

## Step 2 — Hygiene

- Squash `WIP:` commits into clean atomic commits (`git rebase -i` with fixup/squash; reset-soft only if ALL commits are WIP). Preserve meaningful messages.
- Stage intentional files only — **never `git add -A`**. Do not commit broken or mid-edit states.

## Step 3 — Verify

1. Sync with base: `git fetch origin <base>` ; if behind, rebase or merge-base update.
2. Run the full test suite (detect command from package.json scripts / Makefile / CI config). All must pass — new failures block the ship; pre-existing failures are triaged and reported, not auto-blocking.
3. **Coverage audit**: new/changed logic paths must have tests. Audit the diff against existing test files: list untested branches explicitly. Gaps within reason → generate the missing tests and commit them; larger gaps → flag in the PR body rather than blocking.
4. **Pre-landing review gate**: a code review of this diff must have completed without open CRITICAL findings before pushing. If it hasn't happened in this workflow, do a rapid structural pass yourself and report its verdict.

## Step 4 — TODOS.md management (mandatory)

1. Read `TODOS.md` if present. Mark items completed by this branch's work (move to a Completed section or check off, preserving history).
2. Add new TODOS for deliberate follow-up work discovered while shipping (known gaps, deferred polish) — one line each, actionable wording.
3. If `TODOS.md` doesn't exist but follow-ups were found, create it with those items.

## Step 5 — Push & PR

1. Push with upstream tracking.
2. Create PR via `gh pr create` (GitHub) or `glab mr create` (GitLab) with:
   - Clear title (imperative mood, what changed)
   - Body: what & why, how to test, coverage notes, flagged gaps
   - Reference related issues; mention TODOS.md additions
3. If a PR already exists for the branch, update its body instead of creating a duplicate (idempotent re-run).

## Git best practices throughout

- Atomic, bisectable commits — one logical change each; imperative-mood subjects.
- Never `git add -A`; stage intentional files only.
- Never commit broken tests or mid-edit state.
- Force-push only your own unshared feature branch, never shared branches.

## Output format

End every ship phase with:

```
SHIP REPORT
Branch:      [branch]
Commits:     [count after hygiene]
Tests:       [pass/fail counts]
Coverage:    [gaps found → fixed / flagged]
TODOS.md:    [updated / created / n/a]
PR:          [url]
CI:          [status if checkable]
Status:      SHIPPED | BLOCKED_[reason]
```
