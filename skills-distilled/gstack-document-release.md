# Skill: gstack-document-release (distilled for the documentation phase)

Post-ship documentation update. Runs after code is committed/PR'd: ensure every doc file in the project is accurate, up to date, and user-forward.

## Posture

Mostly automated. Make obvious factual updates directly. Stop and ask only for risky or subjective decisions.

**Only stop for:** risky doc changes (narrative, philosophy, security, removals, large rewrites), new TODOS items, narrative cross-doc contradictions.

**Never stop for:** factual corrections from the diff, table/list additions, path/count/version updates, stale cross-references, marking TODOS complete.

**NEVER:** regenerate CHANGELOG entries (polish wording only, preserve content); overwrite CHANGELOG wholesale — always targeted edits with exact anchors.

## Method

1. **Pre-flight**: feature branch check; `git diff <base>...HEAD --stat`, `git log <base>..HEAD --oneline`, `--name-only`.
2. **Change classification**: new features / changed behavior / removed functionality / infrastructure.
3. **Doc discovery**: find all `*.md` (maxdepth 2, exclude `.git`, `node_modules`, `.gstack`).
4. **Coverage map** (Diataxis): for each changed area classify which doc types exist vs missing:
   - *Tutorial* — learning-oriented walkthrough
   - *How-to* — task-oriented goal recipe
   - *Reference* — complete technical description
   - *Explanation* — why it works this way
5. **Apply factual updates** for everything the diff clearly dictates.
6. **Gap handling**: where the coverage map finds docs missing entirely, chain the document-generate pass (research the code, then write the missing Diataxis quadrants) rather than leaving the gap.
7. **Cross-doc consistency sweep**: version numbers, paths, counts, stale references.
8. **Commit** doc updates as their own atomic commit (`docs:` prefix).

## Output format

```
DOC REPORT
Files reviewed:    N
Updated:           [list with what changed]
Generated:         [new files via generate pass, or "none"]
Gaps remaining:    [anything deliberately not written, and why]
Status:            DONE | DONE_WITH_GAPS
```
