<!-- provenance: .agents-clean/skills/tasks/SKILL.md · distilled 2026-08-24 · trimmed: YAML frontmatter, task-breakdown narrative (folded into Inputs/Phases), DoD prose -->

# Skill: gstack-sprint-tasks (distilled for workflow phases)

## Atomicity bar
One verifiable outcome per task. "Build the backend" is not a task; "POST /api/login returns HTTP 200 + JWT for valid credentials" is. Tasks are representationally independent, sequentially assignable, and collected into `tasks_XX.md` at repo root, sorted by ID.

## Per-task fields (all mandatory)
inputs (component layer, context) · data payloads / API schemas / env contexts · constraints (boundary obedience to *system-design_XX.md* + *ADR-log_XX.md*, glossary enforcement) · unhappy paths (fallback behavior or structured error payload) · falsifiable success condition (exact Action + verifiable Expected output) · role assignment (the ROLE block) · dependencies (expressed via sequential ID ordering).

## Role blocks for gstack phases
Emit one `## ROLE` block per consuming sub-agent. Mapping: **frontend-developer** and **backend-developer** blocks feed the implement phase; **qa-engineer** blocks feed the test/review phase — each Success condition becomes a test case. Planner/architect/devops roles stay out of scope unless asked.

## Inputs
Ingest `user-story_XX.md` (functional requirements), `system-design_XX.md` (architecture), `ADR-log_XX.md` (decisions). Enforce `definition-of-done.md` before closing.

## Template (verbatim — never modify)

```markdown
## ROLE (e.g., BACKEND DEVELOPER)

### Goal_XX
[Goal that the sub-agent should reach by completing its tasks]
[Extended description of the goal to provide macroscopic context to the agent]

### TASK_XX
- **Atomic description**: [title, description]
- **Context & inputs**: [component layer from system-design (e.g., API Layer / Worker Core), data payload & invariants]
- **Constraints**: [glossary enforcement, boundary obedience (constraints from *system-design_XX.md* and *ADR-log_XX.md*)]
- **Unhappy paths**: [technical fallback behavior or structured error payload response]
- **Success condition**:
  - Action: [exact CLI command, test script, or endpoint to call]
  - Expected: [expected verifiable output (e.g., "exit status 0" or "HTTP 200")]
- **Execution steps**: [ordered list of steps]
```
