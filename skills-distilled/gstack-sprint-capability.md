<!-- provenance: .agents-clean/skills/product-capability/SKILL.md · distilled 2026-08-24 · trimmed: when-to-use list, inputs inventory, good-outcomes prose, motivational framing, repeated rules -->

# Skill: gstack-sprint-capability (distilled for workflow phases)

Turns product intent into an implementation-ready capability plan: user story first, then engineering constraints. Run before multi-service work starts.

## Half 1 — User story artifact (`user-story_XX.md`)

One file per story, XX zero-padded. Structure:

- **Goal** — one sentence naming the new capability that exists after this ships.
- **Actor** — who the user or operator is.
- **Outcome** — what changes because of it.
- **Acceptance criteria** — each criterion falsifiable: worded so a test can clearly pass or fail it ("returns 409 when quota exceeded", never "handles conflicts gracefully").

Rules: do not invent product truth — mark unresolved points explicitly. Separate user-visible promises from implementation details.

## Half 2 — Capability constraints

Translate the story into checkable engineering constraints:

- **Invariants** — state each as a boolean condition an assertion could evaluate (`every order has exactly one owner`; `no refund without a captured payment`). If it cannot be evaluated true/false, it is not yet an invariant.
- **Trust boundaries** — enumerate every edge where untrusted input enters: user input, third-party API responses, model output, webhooks, file uploads. For each, name the validation that must occur before privileged use.
- **Non-goals** — what this lane explicitly does not own. Unstated exclusions get filled by scope creep.

Also extract: business rules, data ownership, lifecycle transitions, rollout/migration requirements, failure and recovery expectations. If a constraint conflicts with existing repo constraints, say so plainly instead of smoothing it over.

## Output template

Return the result in this order:

```text
CAPABILITY
- one-paragraph restatement (actor, new capability, changed outcome)

CONSTRAINTS
- fixed rules, boolean invariants, trust boundaries

IMPLEMENTATION CONTRACT
- actors / surfaces / states and transitions / interface and data implications

NON-GOALS
- explicit exclusions

OPEN QUESTIONS
- blockers or product decisions still required

HANDOFF
- ready to implement | needs architecture review | needs product clarification
```

## Handoff gate

Never end silently ambiguous: name the delivery lane — direct implementation, architecture review first, or product clarification first.
