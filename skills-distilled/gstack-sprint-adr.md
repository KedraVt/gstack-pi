<!-- provenance: .agents-clean/skills/adr/SKILL.md · distilled 2026-08-24 · trimmed: workflow narrative steps, alternative-solution rigor details, cross-sprint numbering examples -->
# Skill: gstack-sprint-adr (distilled for workflow phases)

Write an ADR when the sprint demands a **significant architectural change** that *system-design_XX.md* cannot absorb under current structural constraints. If no such change exists, create a placeholder *ADR-log_XX.md* stating "No architectural changes required for this sprint".

**Discipline**
- *ADR-log_XX.md* is append-not-rewrite: never edit past entries; change decisions by adding a new ADR that supersedes the old one.
- Reference files matching the sprint number (sprint 05 → *user-story_05.md*, never older sprints).
- Each decision must explain why the choice was made and its consequences; at least one alternative must be documented before choosing.

**Output template (verbatim):**

```markdown
## ADR-[XXX]: [Decision Title]

### Status

Proposed | Accepted | Deprecated | Superseded by ADR-XXX

### Context

Summary of the changes requested in *user-story_XX.md*.

### Decision

The change being adopted, explaining why, with references to *system-design_XX.md*.

### Consequences (Trade-offs)

What becomes easier or harder because of this change? What are we giving up?
```

Every *ADR-log_XX.md* ends with a machine-readable status block (verbatim):

```markdown
## STATUS == pending | approved | rejected
## BLOCKING_ISSUES == none | <comma-separated list>
```
