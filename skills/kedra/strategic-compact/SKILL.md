---
name: strategic-compact
description: Context compaction strategy for sub-agents. Use this skill at the end of a task execution to summarize findings, decisions, and code changes cleanly, intentionally discarding temporary debugging context and failed attempts before reporting back to the orchestrating agent (Planner).
version: "1.0.0"
---

# Strategic Compact (Context Compaction)

When working as a sub-agent in a parallel execution environment, generating extensive logs, debugging trails, and failed attempts can overwhelm the context window of the orchestrating agent (Planner).

To prevent this, you MUST apply the **Strategic Compact** protocol before finishing your task.

## The Protocol

1. **Clean Your Workspace**: Ensure all temporary scratch files, debug logs, and failed attempts are either deleted or moved to a local `tmp/` folder that the Planner does not need to read.
2. **Generate the Compact Summary**: Create a single artifact named `compact-summary_[Role]_XX.md` (e.g., `compact-summary_frontend_05.md`).
3. **Format Requirements**:
   - **Status**: [SUCCESS / FAILED]
   - **Diff / Changes Made**: Briefly list the files modified and the nature of the changes.
   - **Architectural Decisions**: Any trade-offs made or ADRs updated.
   - **Test Results**: Proof that the code passes local verification (do not dump the entire stdout, just the final summary).
4. **Silence the Noise**: In your final message back to the Planner, DO NOT include your reasoning loop, debugging steps, or raw code. Simply state: "Task completed. See `compact-summary_[Role]_XX.md` for the compacted results."

## When to Use

- ALWAYS, right before marking a sprint task as complete.
- NEVER send raw compilation errors or long stack traces back to the Planner unless you are completely blocked and need architectural help.

## Status Block

End the compact summary with a machine-readable status block so the Planner can parse the outcome:

```markdown
## STATUS == SUCCESS | FAILED
```
