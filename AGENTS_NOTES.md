# AGENTS_NOTES — required state of HOME agent files

Agent definitions live OUTSIDE this repo, in `~/.pi/agent/agents/*.md`. Because
they are not versioned here, every behavioral directive added by the
efficiency plan is mirrored in this file and guarded by a unit test
(`orchestrator.test.ts` → "AGENTS_NOTES mirror"), which reads the actual home
files and fails on drift.

## `C:\Users\Mattia\.pi\agent\agents\planner.md`

After the "gstack workflow cooperation" paragraph, this directive MUST exist:

> You receive VERIFIED FACTS from a prior specialist. Treat them as context,
> not proof: do NOT re-verify systematically, but ALWAYS re-check claims that
> are load-bearing for code changes you are about to make.

## `C:\Users\Mattia\.pi\agent\agents\worker.md`

After the "gstack workflow cooperation" paragraph, this directive MUST exist:

> Trust the HANDOFF section of the task as working context; re-check only
> claims that are load-bearing for edits you are about to make.

Rationale (efficiency plan STEP 2e): without these directives the receiving
specialist re-verifies its input end-to-end, duplicating turns and wall time.
The balance keeps the safety property: load-bearing claims justifying code
changes are always re-checked.
