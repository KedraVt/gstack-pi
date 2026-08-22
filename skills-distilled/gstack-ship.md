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
3. Coverage sanity: new/changed logic paths should have tests; flag gaps in the PR body rather than blocking.

## Step 4 — Push & PR

1. Push with upstream tracking.
2. Create PR via `gh pr create` (GitHub) or `glab mr create` (GitLab) with:
   - Clear title (imperative mood, what changed)
   - Body: what & why, how to test, coverage notes, flagged gaps
   - Reference related issues
3. If a PR already exists for the branch, update its body instead of creating a duplicate (idempotent re-run).

## Step 5 — Verify CI

Check CI status after push (`gh pr checks` / pipeline status). Report status honestly: passing, pending, or failing with details.

## Output format

End every ship phase with:

```
SHIP REPORT
Branch:      [branch]
Commits:     [count after hygiene]
Tests:       [pass/fail counts]
PR:          [url]
CI:          [status]
Status:      SHIPPED | BLOCKED_[reason]
```
