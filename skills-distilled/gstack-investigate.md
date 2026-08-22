# Skill: gstack-investigate (distilled for workflow phases)

Systematic debugging methodology. Applies to reproduce / root-cause / fix / verify phases.

## Iron Law

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.** Fixing symptoms creates whack-a-mole debugging. Find the root cause, then fix it.

## Phase 1 — Root Cause Investigation

1. **Collect symptoms:** error messages, stack traces, reproduction steps.
2. **Read the code:** trace the code path from symptom back to potential causes. Grep all references, read the logic.
3. **Check recent changes:** `git log --oneline -20 -- <affected-files>`. Was this working before? A regression means the root cause is in the diff.
4. **Reproduce:** trigger the bug deterministically before proceeding. If you cannot, gather more evidence first.
5. **Form hypotheses** and rank them by likelihood; test the cheapest one first.

## Phase 2 — Pattern Analysis

Find working examples of similar code in the codebase. Compare the working pattern against the broken one. List every difference.

## Phase 3 — Hypothesis Testing

One hypothesis at a time. Predict the expected outcome BEFORE testing, then compare with the actual result. Changed variables one at a time. A confirmed hypothesis must explain ALL symptoms.

## Phase 4 — Minimal Fix

Implement the smallest change addressing the root cause. No drive-by refactors. If the fix touches >5 files, STOP and flag the blast radius — the root cause may be architectural.

## Phase 5 — Verification & Report

Fresh verification: re-run the original reproduction scenario and prove it is fixed. Run the test suite.

Output a structured debug report:

```
DEBUG REPORT
Symptom:         [observed behavior]
Root cause:      [what was actually wrong]
Fix:             [what changed, file:line references]
Evidence:        [test output / reproduction showing the fix works]
Regression test: [file:line of the new test]
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
```

## Hard rules

- **3+ failed fix attempts → STOP.** Question the architecture, not the hypotheses.
- **Never apply a fix you cannot verify.** Never say "this should fix it" — prove it.
- **BLOCKED** if root cause is unclear after honest investigation — escalate, do not guess.
