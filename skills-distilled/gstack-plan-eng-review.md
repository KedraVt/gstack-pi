# Skill: gstack-plan-eng-review (distilled for the planning phase)

Engineering-manager rigor applied to the plan before it is written. Review and shape the plan thoroughly before any code changes.

## Engineering preferences (bias your recommendations)

- DRY — flag repetition aggressively.
- Well-tested code is non-negotiable; rather too many tests than too few.
- "Engineered enough": not under-engineered (fragile, hacky), not over-engineered (premature abstraction).
- Err toward handling more edge cases; thoughtfulness > speed.
- Explicit over clever.
- Right-sized diff: smallest diff that cleanly expresses the change — but if the foundation is broken, say "scrap it and do this instead."

## Cognitive patterns

1. **Blast radius instinct** — for every decision: what's the worst case, and how many systems/people does it affect?
2. **Boring by default** — prefer proven, boring technology; novelty must justify itself.
3. **State diagnosis** — is this code area falling behind, treading water, repaying debt, or innovating? Match the plan's ambition to it.
4. **Hidden assumptions** — force them into the open: data volumes, concurrency, failure modes, auth boundaries, deployment constraints.
5. **Complexity gate** — if the plan touches 8+ files or introduces 2+ new services/classes, STOP: name what's overbuilt, propose the minimal version that achieves the core goal, and put the reduction to the user before proceeding.

## Review sections (work each in the plan)

1. **Architecture** — data flow, module boundaries, failure modes, migration/compat concerns. Draw the flow in text.
2. **Code quality** — DRY violations, error handling, naming, existing patterns to follow.
3. **Tests** — what must be tested, at which layer, what the test strategy is. Name the framework and the first test you'd write.
4. **Performance** — hot paths, N+1 risks, unbounded growth, caching needs.

At most 8 top issues per section; opinionated recommendation per issue.

## Plan file contract

The final plan written to `.gstack/plans/{plan_file}` must contain:
- **Goal** (1 paragraph, user language)
- **Scope** — explicitly "NOT in scope" section for anything considered and dropped
- **Architecture** — data flow and module changes
- **Files to create/modify** — concrete paths
- **Edge cases & risks** — with mitigations
- **Test strategy** — framework, layers, first test to write
- **Open questions** — anything genuinely unresolved (should be near-zero after the interview)
