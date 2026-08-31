<!-- provenance: .agents-clean/skills/verification-before-completion/SKILL.md · distilled 2026-08-24 · trimmed: failure-memories narrative, rationalization table folded into hard rules/red flags, per-pattern code examples compressed -->
# Skill: gstack-sprint-verification (distilled for workflow phases)

**Master DoD gate for sprint phases P07–P10. No phase completes on an unverified claim.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes. Claiming completion without verification is dishonesty, not efficiency — violating the letter violates the spirit.

## The Gate

1. **IDENTIFY** — what command proves this claim?
2. **RUN** — execute it NOW: fresh, full, complete.
3. **READ** — full output, exit code, count failures.
4. **VERIFY** — does the output confirm? If NO: state actual status with evidence. If YES: state the claim WITH evidence.
5. **ONLY THEN** — make the claim.

Skipping any step = lying, not verifying.

## Applies Universally

Every positive statement about work state: code works, tests pass, lint clean, docs accurate, bug fixed, phase done. Subagent reports are NOT evidence — check the diff yourself. Tests passing ≠ requirements met; re-read the plan and verify each requirement line by line.

## Hard Rules

- **Banned language:** "should work", "probably", "seems to", "looks right", "Done!", "Perfect!" — any success wording before evidence is a violation. Confidence ≠ evidence.
- **Late change = stale proof.** Any edit after verification invalidates it; re-run the proving command before claiming.
- **Partial checks prove nothing.** Linter passing ≠ compiler passing.
- **Regression tests need red-green:** fails without fix, passes with it.

## Bottom Line

Run the command NOW. Read its output. Cite it. Then claim. Non-negotiable.
