# Skill: gstack-review (distilled for workflow phases)

Pre-landing review methodology. Applies to the review phase and any code-review step.

## Mindset

Find the bugs that pass CI but blow up in production. Analyze the branch diff against the base branch for **structural issues tests don't catch**.

## Step 0 — Base branch

Detect the base branch: `gh pr view --json baseRefName`, else repo default branch, else `main`. Diff against `git merge-base origin/<base> HEAD`.

## Step 1 — Branch check

If on the base branch or no diff exists: report "Nothing to review" and stop.

## Step 1.5 — Scope drift detection (before code quality)

Did they build what was requested — nothing more, nothing less?

1. Identify stated intent from commit messages (`git log origin/<base>..HEAD --oneline`) and any PR description.
2. Compare files changed against stated intent.
3. Detect:
   - **SCOPE CREEP:** unrelated files changed, unplanned refactors, "while I was in there..." changes.
   - **MISSING REQUIREMENTS:** stated requirements not addressed in the diff.

Report: `Scope Check: [CLEAN / DRIFT DETECTED / REQUIREMENTS MISSING]` with evidence.

## Step 2 — Structural review

Read the full diff (`git diff <merge-base>..HEAD`). Check for:
- Bugs that pass CI: race conditions, unhandled errors, boundary values, null/undefined paths
- SQL safety (injection, missing migrations), LLM trust-boundary violations (unvalidated model output used in privileged contexts)
- Conditional side effects (code that only misbehaves under specific flags/data)
- Security: secrets in code, missing auth checks, unsafe input handling
- Performance: N+1 queries, unbounded loops, missing indexes
- Missing tests for new behavior paths

## Step 3 — Findings report

Categorize by severity:

```
CRITICAL — production breakage, data loss, security hole → must fix before landing
HIGH — likely bug, wrong behavior in realistic scenarios → should fix
MEDIUM — fragile code, missing tests, poor error handling → should fix
LOW — style, naming, minor polish → optional
```

Each finding: file:line, what breaks, concrete scenario. Auto-fix only the obvious mechanical ones (dead code, stale comments) with atomic commits; flag judgment calls.

## Step 4 — Completeness gaps

Flag what is missing: tests for new paths, error handling, docs updates, migration needs.

## Hard rules

- Never approve with open CRITICAL findings.
- Every HIGH/CRITICAL finding needs a concrete failure scenario, not a hunch.
- Report must end with a clear verdict: APPROVE, APPROVE_WITH_FIXES, or REQUEST_CHANGES.
