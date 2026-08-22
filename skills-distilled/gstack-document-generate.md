# Skill: gstack-document-generate (distilled; chained from document-release)

Author high-quality, structured documentation for features/modules that lack it. Research the whole before writing any part — prevents "docs that describe half the feature".

## Diataxis framework — four quadrants

- **Tutorial** — learning-oriented, step-by-step working example
- **How-to** — task-oriented recipe for a specific goal
- **Reference** — information-oriented, complete and accurate
- **Explanation** — understanding-oriented, the "why"

## Decision matrix (not every entity needs all four)

| Entity | Tutorial | How-to | Reference | Explanation |
|---|---|---|---|---|
| User-facing feature | ✅ | ✅ | ✅ | maybe |
| CLI command / flag | maybe | ✅ | ✅ | no |
| Internal module | no | no | ✅ | ✅ |
| Config option | no | ✅ | ✅ | no |
| API endpoint | maybe | ✅ | ✅ | no |

## Method

1. **Codebase archaeology first** (most important step): read entry points, README/ARCHITECTURE/contributor docs, package manifests, implementation files end-to-end (not just signatures), tests (they reveal intended behavior + edge cases), inline `NOTE:/DESIGN:/WHY:` comments.
2. **Concept map before writing**: purpose (1 sentence), 3–5 key concepts, public surface, dependencies/dependents, edge cases, non-obvious design decisions.
3. **Partition per the matrix**; output the plan (entity × quadrant).
4. **Write reference docs FIRST** — they are factual, derived directly from code, and establish the vocabulary tutorials and how-tos reuse.
5. Follow existing `docs/` conventions and doc-framework formats if present; otherwise plain Markdown in `docs/`.

## Quality bars

- Every code sample must be runnable or taken verbatim from the repo.
- No documentation of planned-but-nonexistent behavior.
- Each doc states its audience in the first line.
