# Skill: gstack-fix-strategy

Minimal-fix strategy for a CONFIRMED root cause (from the investigate
methodology's Phase 4). For planners validating an already-identified cause.

## Rules

- No fix without a validated mechanism (`mechanism @ file:line`).
- Minimal diff only; no drive-by refactors.
- Every fix ships a regression test failing before, passing after.

## Procedure

1. Verify the cited files and mechanism (≤5 targeted reads).
2. Confirmed → first line `VALIDATED: <mechanism @ file:line>`, then files to
   change, per-file edits, regression risks.
3. Refuted → first line `REFUTED: <reason>`; no fix proposal.

## Hard rules

- Never claim a fix works without re-running the reproduction.
- Stop after 3 failed hypotheses; report BLOCKED with evidence.
