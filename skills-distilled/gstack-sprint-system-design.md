<!-- provenance: .agents-clean/skills/system-design/SKILL.md · distilled 2026-08-24 · trimmed: compose files & port-spacing topology, SSE stream mandates, full JSON endpoint/CORS/header templates, observability/tracing matrix, project-specific examples -->

# Skill: gstack-sprint-system-design (distilled for workflow phases)

Tactical Domain-Driven Design applied to a sprint before code is written. Input: the user story; output: *system-design_XX.md*, pairing 1:1 with *user-story_XX.md*. Structure only — no conversational filler.

## Workflow

1. **Scan the story** — extract what the PM wants via events/brainstorming.
2. **Ubiquitous language** — extract the shared glossary table (template below); BINDING on all dev agents downstream.
3. **Domains** — classify components: **Core domain** (business logic, execution engine — high rigor, sandboxing) vs **Supporting/Generic** (CRUD, metadata, logging).
4. **Aggregates & invariants** — define coherent aggregate boundaries; write every invariant as an immutable Boolean condition so automated QA can verify it mechanically.
5. **Context mapping** — map every sprint-affected component boundary as Upstream/Downstream. For each Downstream edge choose and justify: **ACL** (sandboxes untrusted / AI-generated inputs) or **Conformist** (direct internal trust).
6. **Data flows** — command → aggregate state change → domain event → event handler executes task → final state. Long-running async jobs get explicit state machines (e.g., Saga) tracking intermediate states, strict unhappy paths.
7. **Contracts** — draft exact, strictly-typed JSON payloads reflecting the aggregates and invariants; never lazy/generic structures. Contracts are immutable once written. Module dependencies flow strictly inward toward Core (hexagonal).
8. **Storage** — ADVISORY only: SQLite for prototypes; PostgreSQL for concurrent production access.

## Required design-doc sections

### Ubiquitous Language — BINDING for all dev agents

| Domain Term | Technical Name (Code/DB) | Definition | Allowed Synonyms |
| :--- | :--- | :--- | :--- |
| [Term] | [exact naming rule] | [business context] | NONE |

One concept, one name everywhere (code, DB, docs); synonyms default NONE.

### Aggregates & System Invariants

- **Aggregate Root**: `[Name]`
  - `INV-01`: strict logical condition (e.g., "a ProcessingJob cannot be COMPLETED if OutputPath is NULL")

### Context Mapping Matrix

| Upstream | Downstream | Strategy (ACL / Conformist) | Tactical purpose & data contract |
| :--- | :--- | :--- | :--- | — include payload structure + how downstream digests/isolates the data.

### Immutable API Contracts

- Exact request/response JSON per interaction: keys + types, success and collection/pagination shapes.
- Every contract MUST define the unhappy-path payload: `{ "error_code": "string", "message": "string // invariant violation or failure" }`.
- Enforce immutability at runtime with schema validators (Pydantic backend, Zod/TypeScript frontend).

### Unhappy Paths & State Rollback

Per failure mode: **Detection Point** (which component catches it) → **Rollback & Cleanup** (state update, queue eviction, DLQ, host-file purge). Map external-dependency and LLM-output failures to retry policies, dead-letter queues, circuit breakers.

## Hard rules

- Execution workers are stateless for horizontal scaling.
