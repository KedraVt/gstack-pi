import type { WorkflowPhase, WorkflowContext, Workflow } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { loadSkillDigest, getSkillInfo, type SkillInfo } from "./skills.ts";
import { skillsEnabled, manualGates, deterministicSubagents } from "./config.ts";
import { replaceExact } from "./text.ts";
import { extractHandoff } from "./handoff.ts";
import { parseRootCauseMarker, validateStrategyTask } from "./skip.ts";

/** Deterministic slug for the plan file written by the interactive planning phase. */
export function planFileSlug(goal: string): string {
  return (
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "plan"
  );
}

export function planFilePath(goal: string): string {
  return `.gstack/plans/${planFileSlug(goal)}.md`;
}

export function buildPhaseInstructions(phase: WorkflowPhase, ctx: WorkflowContext): string {
  const workflow = getWorkflow(ctx.state.workflowId);
  const totalPhases = workflow?.phases.length ?? 0;
  const parts: string[] = [];

  parts.push(`## [gstack workflow: ${ctx.state.workflowId}] Phase: ${phase.name}`);
  parts.push(`**Goal:** ${ctx.state.goal}`);
  parts.push(`**Progress:** Phase ${ctx.state.phaseIndex + 1} of ${totalPhases}`);
  parts.push(`**Branch:** ${ctx.git.branch}`);
  parts.push("");

  const priorResults = Object.entries(ctx.state.results)
    .filter(([, r]) => r.status === "completed")
    .map(([id, r]) => `- **${id}**: ${r.summary}`);
  if (priorResults.length > 0) {
    parts.push("### Completed phases");
    parts.push(priorResults.join("\n"));
    parts.push("");
  }

  if (phase.execution === "main") {
    parts.push(buildMainInstructions(phase, ctx));
    const boundary = scopeBoundaryFor(phase.id);
    if (boundary) {
      parts.push("");
      parts.push(boundary);
    }
  } else if (deterministicSubagents()) {
    // The executor has already spawned the specialists; their output arrives
    // above these instructions. Do not ask the model to delegate again — and
    // do not echo the skill-laden task JSON into orchestrator context.
    parts.push(
      "### Delegated execution",
      "This phase's specialist work was already dispatched deterministically by the orchestrator. Review the subagent output above, verify it against the skill gates below, and summarize.",
    );
  } else {
    parts.push(buildSubagentInstructions(phase, ctx));
  }

  // Skill knowledge tiering:
  //  - main phases work with the methodology themselves → full digest,
  //    unless it was already delivered earlier in this run (then DoD gate only);
  //  - subagent phases: the FULL digest travels inside the specialist's task
  //    (isolated context), while the orchestrator only needs the DoD gate to
  //    verify the output.
  const skillBlock = buildOrchestratorSkillBlock(phase, ctx);
  if (skillBlock) {
    parts.push("");
    parts.push(skillBlock);
  }

  parts.push("");
  parts.push(buildAdvancementRule(phase));

  return parts.join("\n");
}

/**
 * Advancement contract — one uniform rule so the model never improvises:
 * always end the phase by calling gstack_advance yourself; never defer to the
 * user. Whether the workflow continues automatically or pauses for approval
 * after that call is decided by the orchestrator, not the model.
 */
function buildAdvancementRule(phase: WorkflowPhase): string {
  const lines = [
    "---",
    "When this phase is complete, YOU call the `gstack_advance` tool with a 2-3 sentence summary of what was accomplished and status \"completed\". Never ask the user to run a command to continue — the workflow handles progression.",
    // STEP 4a (COR-01): the marker must survive into the SUMMARY — skip.ts
    // reads results[phase].summary, not the report body.
    "If your report ends with a `CONFIRMED ROOT CAUSE:` line, you MUST include that exact line verbatim in your gstack_advance summary.",
  ];
  if (manualGates() && phase.advance === "manual") {
    lines.push(
      "This phase is a DECISION PHASE: after you call gstack_advance, the workflow will pause so the user can review your output before the next phase starts. Present your results clearly and completely — the user's approval depends on them.",
    );
  }
  lines.push("If the phase failed, use status \"failed\" and explain why.");
  return lines.join("\n");
}

function variantDirective(phase: WorkflowPhase): string | null {
  if (phase.variant === "report-only") {
    return "**REPORT-ONLY MODE**: test and classify exactly as instructed, but do NOT fix anything and do NOT commit. The report is the entire deliverable; add a `Recommended fix` line per bug.";
  }
  return null;
}

/**
 * Skill blocks shown in ORCHESTRATOR instructions.
 */
function buildOrchestratorSkillBlock(phase: WorkflowPhase, ctx: WorkflowContext): string | null {
  if (!skillsEnabled() || !phase.skills || phase.skills.length === 0) {
    const vd = variantDirective(phase);
    return vd ? [vd].join("\n") : null;
  }

  const delivered = ctx.state.skillsDelivered ?? [];
  const parts: string[] = [];
  const isSubagentPhase = phase.execution === "subagent";

  for (const id of phase.skills) {
    const info = getSkillInfo(id);
    if (!info) continue;
    parts.push(`#### Skill gate: ${id}`);

    const alreadyDelivered = delivered.includes(id);
    const wantFullDigest =
      !isSubagentPhase && !alreadyDelivered;

    if (wantFullDigest) {
      const digest = loadSkillDigest(id);
      if (digest) {
        parts.push(digest);
        if (info.fullPath) {
          parts.push(`(Full skill documentation for deep consultation: ${info.fullPath})`);
        }
        continue;
      }
      // digest missing → fall through to pointer/gate
      if (info.fullPath) {
        parts.push(`Read and follow the full methodology at: ${info.fullPath}`);
        continue;
      }
    }

    // Subagent phase or repeat delivery: compact DoD + best-practices gate.
    parts.push(info.dod);
    if (!isSubagentPhase && alreadyDelivered) {
      parts.push("(Full methodology delivered in an earlier phase — follow the same rules.)");
    }
  }

  const vd = variantDirective(phase);
  if (vd) parts.push(vd);

  return parts.length > 0 ? parts.join("\n") : null;
}

// Skill classes (efficiency plan §1c): how strictly a digest's output format
// must be treated inside a subagent task.
type SkillClass = "format-critical" | "support";
const SKILL_CLASSES: Record<string, SkillClass> = {
  "gstack-qa": "format-critical",
  "gstack-review": "format-critical",
  "gstack-investigate": "format-critical",
  "grilling": "format-critical",
  "gstack-document-generate": "format-critical",
  "gstack-fix-strategy": "format-critical",
  "gstack-ship": "support",
  "gstack-office-hours": "support",
  "gstack-plan-eng-review": "support",
  "gstack-document-release": "support",
};
export function skillClassFor(id: string): SkillClass {
  return SKILL_CLASSES[id] ?? "format-critical";
}
const FORMAT_CRITICAL_PREFIX =
  "This methodology's output format IS part of the deliverable: severity categories, gates and report structures are MANDATORY.";
const SUPPORT_PREFIX = "Apply the parts useful to the deliverable; nothing more.";

/**
 * Deliverable-first contracts for MAIN-execution phases (path 2 of STEP 1).
 * Every main-phase instruction ends with a falsifiable DELIVERABLE /
 * STOP CONDITION pair so the model optimizes for the artifact, not the method.
 */
const MAIN_CONTRACTS: Record<string, (ctx: WorkflowContext) => string> = {
  "understand": () =>
    "## DELIVERABLE\nA shared-understanding summary: what exists today, what must change, and the chosen approach.\n\n## STOP CONDITION\nStop when: ambiguities are resolved with the user or explicitly listed as open questions.",
  "plan": (c) =>
    `## DELIVERABLE\nA converged plan file at \`${planFilePath(c.state.goal)}\` following the Plan file contract, briefly summarized to the user.\n\n## STOP CONDITION\nStop when: the interview frontier is empty (nothing silently assumed) and the plan file is written. Do NOT start implementing.`,
  "reproduce": () =>
    '## DELIVERABLE\nA reliable, deterministic way to trigger the bug + expected vs actual symptoms, ending with the trailing line `CONFIRMED ROOT CAUSE: <one-line cause> | files: <comma-separated file paths>` or `CONFIRMED ROOT CAUSE: none | files: none`.\n\n## STOP CONDITION\nStop when: the bug is reproduced AND the suspected cause is verified against the code (≤3 targeted reads), or a reliable reproduction exists without an obvious cause.',
  "verify": () =>
    "## DELIVERABLE\nFixed / not-fixed verdict with evidence (reproduction outcome + test results).\n\n## STOP CONDITION\nStop when: the original reproduction steps have been re-run and related tests have been executed.",
  "setup": () =>
    "## DELIVERABLE\nA concrete QA scope: target URL/dev server, user flows under test, and the test plan.\n\n## STOP CONDITION\nStop when: the test plan is defined and summarized.",
  "report": () =>
    "## DELIVERABLE\nA structured bug report: every finding with severity, repro steps, evidence reference, plus what passed and a fix-priority order.\n\n## STOP CONDITION\nStop when: all collected findings are compiled into the report.",
  "pre-checks": () =>
    "## DELIVERABLE\nA ready-to-ship verdict or an explicit blocker list (commits, tests, lint, TODOs, branch status).\n\n## STOP CONDITION\nStop when: every checklist item has been checked and reported.",
  "findings": () =>
    "## DELIVERABLE\nReview findings categorized by severity with file:line references and suggested fixes, plus an overall assessment.\n\n## STOP CONDITION\nStop when: the full diff analysis has been presented.",
  "action": () =>
    '## DELIVERABLE\nThe requested single action (QA / review / ship / investigate) completed, with its standard report.\n\n## STOP CONDITION\nStop when: the action\'s own deliverable is produced.',
};

function mainContractFor(phase: WorkflowPhase, ctx: WorkflowContext): string {
  const builder = MAIN_CONTRACTS[phase.id];
  if (builder) return builder(ctx);
  return `## DELIVERABLE\nA clear, verifiable result for the "${phase.name}" phase, directly usable by the next phase.\n\n## STOP CONDITION\nStop when: the result can be checked against this description as done or not done. Further work is waste.`;
}

function buildMainInstructions(phase: WorkflowPhase, ctx: WorkflowContext): string {
  const templates: Record<string, (ctx: WorkflowContext) => string> = {
    "plan": (c) => [
      "### Instructions — Interactive Planning",
      "You are conducting the planning interview. The scout's codebase findings are in your context above.",
      "",
      "**Interview protocol (grilling)**: map decisions as a design tree; work in rounds over the frontier (questions whose prerequisites are settled). Each round: number the questions, give YOUR recommended answer under each, then STOP and wait for the user's replies.",
      "- Maximum 5 questions per round; only questions that change architecture or scope.",
      "- Never ask the user for a fact you can look up yourself (use the scout output or tools).",
      "- Apply office-hours judgment: challenge vague premises, demand specificity, push for the narrowest shippable scope.",
      "- Apply engineering rigor: blast radius, hidden assumptions, edge cases, test strategy; complexity gate at 8+ files or 2+ new services.",
      "",
      "**Termination**: when the frontier is empty (or answers are exhausted), write the converged plan to `" + planFilePath(c.state.goal) + "` following the Plan file contract in the skill gates below, summarize it briefly to the user, then call gstack_advance. Do NOT start implementing.",
    ].join("\n"),

    "understand": (c) => [
      "### Instructions",
      "Analyze the user's goal and the current codebase to establish shared understanding:",
      `1. Read relevant files and understand the existing architecture`,
      `2. Identify constraints, dependencies, and patterns to follow`,
      `3. Clarify ambiguities by asking the user (if needed)`,
      `4. Summarize: what exists, what needs to change, what's the approach`,
    ].join("\n"),

    "reproduce": (c) => [
      "### Instructions",
      "Reproduce the bug systematically:",
      `1. Read error messages, stack traces, or user description: "${c.state.goal}"`,
      `2. Identify the affected code path (read relevant files)`,
      `3. Attempt reproduction (run tests, start dev server, or use browser tools)`,
      `4. Document: exact steps to reproduce, expected vs actual behavior`,
      `5. If you cannot reproduce, state what you tried and what's needed`,
      "",
      "If your report ends with a `CONFIRMED ROOT CAUSE:` line, you MUST include that exact line verbatim in your gstack_advance summary.",
    ].join("\n"),

    "verify": (c) => [
      "### Instructions",
      "Verify the fix works correctly:",
      `1. Re-run the reproduction steps from the "reproduce" phase`,
      `2. Confirm the bug is fixed (expected behavior now occurs)`,
      `3. Run related tests: unit tests, integration tests`,
      `4. Check for obvious regressions in adjacent functionality`,
      `5. Report: fixed (with evidence) or not fixed (with details)`,
    ].join("\n"),

    "setup": (c) => [
      "### Instructions",
      "Set up the QA testing scope:",
      `1. Identify what to test: "${c.state.goal}"`,
      `2. Determine the target URL or dev server (ask user if unclear)`,
      `3. Define the test plan: which user flows, which breakpoints`,
      `4. Ensure the gstack browser binary is available (use gstack_status tool)`,
      `5. Summarize the test plan before proceeding`,
    ].join("\n"),

    "report": (c) => [
      "### Instructions",
      "Compile the QA findings into a structured report:",
      `1. List all bugs found with severity (critical/major/minor/cosmetic)`,
      `2. For each bug: steps to reproduce, expected vs actual, screenshot reference`,
      `3. Note what passed (working flows)`,
      `4. Recommend fix priority order`,
      `5. Ask user: "Want me to fix these issues, or just report?"`,
    ].join("\n"),

    "pre-checks": (c) => [
      "### Instructions",
      "Run pre-flight checks before shipping:",
      `1. Verify all changes are committed (git status)`,
      `2. Run the test suite (identify test command from package.json/Makefile)`,
      `3. Run linter/type checker if configured`,
      `4. Check for TODO/FIXME in changed files`,
      `5. Verify branch is up to date with remote`,
      `6. Report: ready to ship, or blockers found`,
    ].join("\n"),

    "findings": (c) => [
      "### Instructions",
      "Present the code review findings:",
      `1. Read the diff analysis from the previous phase`,
      `2. Categorize findings: critical (must fix), warning (should fix), suggestion (nice to have)`,
      `3. For each finding: file, line, issue, suggested fix`,
      `4. Give an overall assessment: approve, request changes, or needs discussion`,
      `5. Ask user: "Want me to apply the suggested fixes?"`,
    ].join("\n"),

    "action": (c) => [
      "### Instructions",
      `The user requested a quick action: "${c.state.goal}"`,
      `Determine which single action to perform (QA, review, ship, or investigate) and execute it directly.`,
      `Use the appropriate gstack tools and workflows. Keep it focused and fast.`,
    ].join("\n"),
  };

  const builder = templates[phase.id];
  const base = builder
    ? builder(ctx)
    : [
        "### Instructions",
        `Execute the "${phase.name}" phase for goal: "${ctx.state.goal}"`,
        "Use available tools to accomplish this phase.",
        "Focus on producing a clear, actionable result.",
      ].join("\n");
  return `${base}\n\n${mainContractFor(phase, ctx)}`;
}

function buildSubagentInstructions(phase: WorkflowPhase, ctx: WorkflowContext): string {
  const parts: string[] = [];

  parts.push("### Action: Use the `subagent` tool");
  parts.push("");

  if (phase.chain && phase.chain.length > 1) {
    parts.push("Call the `subagent` tool in **chain mode** with these parameters:");
    parts.push("");
    parts.push("```json");
    parts.push(JSON.stringify({
      chain: phase.chain.map((step) => ({
        agent: step.agent,
        // STEP 3c: per-step skill override, defaulting to the phase's skills.
        task: interpolate(buildTaskSkills(phase, step.task, step.skills ?? phase.skills), ctx),
      })),
    }, null, 2));
    parts.push("```");
    parts.push("");
    parts.push("Each step receives the previous step's output via `{previous}`.");
  } else {
    const agent = phase.agent ?? "worker";
    const task = interpolate(buildAgentTask(phase, ctx), ctx);
    parts.push(`Call the \`subagent\` tool with these parameters:`);
    parts.push("");
    parts.push("```json");
    parts.push(JSON.stringify({ agent, task }, null, 2));
    parts.push("```");
  }

  parts.push("");
  parts.push("After the subagent completes, review its output and call `gstack_advance` with a summary.");
  parts.push("If the subagent fails, call `gstack_advance` with status \"failed\" and explain what went wrong.");

  return parts.join("\n");
}

function buildAgentTask(phase: WorkflowPhase, ctx: WorkflowContext): string {
  // Deliverable-first contracts (STEP 1): fixed 4-block order for every
  // subagent task — DELIVERABLE / STOP CONDITION / CONTEXT / METHODOLOGY
  // (methodology is appended last by buildTaskSkills).
  const tasks: Record<string, string> = {
    "explore": `## DELIVERABLE
Relevant files with absolute paths and line references, architectural patterns, constraints, and test infrastructure. Facts only — no design proposals.

## STOP CONDITION
Stop when: every area of the goal has at least one mapped file and the patterns/constraints are listed. Further exploration is waste.

## CONTEXT
Goal: {goal} | Branch: {branch}

Find all code that matters: entry points, affected modules, existing patterns, architecture constraints, test infrastructure. Report file paths (absolute), key functions, patterns to follow, and anything surprising.`,
    "implement": `## DELIVERABLE
Code implementing the approved plan, a list of justified deviations (if any), and the tests you ran.

## STOP CONDITION
Stop when: the plan is implemented and tests are green.

## CONTEXT
Goal: {goal} | Branch: {branch}
The full plan is in the file: {plan_file}. Read it FIRST and follow it — it contains the goal, scope, architecture, files to change, edge cases, and test strategy agreed with the user.
Context from prior phases:
{plan_summary}

Write production-quality code. Run tests after implementation. Report what was implemented, any deviations from the plan (and why), and any issues.`,
    "qa": `## DELIVERABLE
For each goal-related flow: pass/fail verdict + screenshot evidence + severity (CRITICAL/HIGH/MEDIUM/LOW) per bug found, ending with the line \`COVERAGE: <tested flows>\`.

## STOP CONDITION
Stop when: the required flows are covered OR two passes produce no new findings. Deliverable flows are ALWAYS mandatory.

## CONTEXT
Goal: {goal} | Branch: {branch}

Use the gstack browser tools to test user flows. Core set: gstack_goto, gstack_snapshot, gstack_click, gstack_fill or gstack_type (form inputs — never declare a form flow tested without exercising its inputs), gstack_wait (settle SPAs before asserting), gstack_console with --errors after each flow (silent JS failures are bugs), gstack_screenshot for evidence; others (gstack_network, gstack_select, gstack_scroll, ...) as needed. Report all bugs found with severity.`,
    "review": `## DELIVERABLE
Findings with severity + file:line + concrete failure scenario, a scope check, and a final verdict APPROVE or REQUEST_CHANGES.

## STOP CONDITION
Stop when: the full diff has been analyzed.

## CONTEXT
Goal: {goal} | Branch: {branch}

Run git diff to see changes. Check for: bugs, security issues, performance problems, style violations, missing tests. Report findings categorized by severity.`,
    "ship": `## DELIVERABLE
Branch pushed, PR URL, TODOS.md updated, atomic commits verified.

## STOP CONDITION
Stop when: the ship checklist is complete.

## CONTEXT
Goal: {goal} | Branch: {branch}

1. Ensure all changes are committed
2. Push to remote
3. Create a PR with a clear title and description
4. Report the PR URL and any CI status`,
    "fix": `## DELIVERABLE
Minimal fixes applied for the findings below, tests green, regression coverage for CRITICAL/HIGH findings.

## STOP CONDITION
Stop when: all findings are addressed.

## CONTEXT
Goal: {goal} | Branch: {branch}
Prior findings:
{findings_summary}

Apply minimal, targeted fixes. Run tests after each fix. Report what was fixed.
If your report ends with a \`CONFIRMED ROOT CAUSE:\` line, you MUST include that exact line verbatim in your gstack_advance summary.`,
    "test": `## DELIVERABLE
Test commands identified + pass/fail counts + failure details.

## STOP CONDITION
Stop when: the suite has completed.

## CONTEXT
Goal: {goal} | Branch: {branch}

Identify the test command (package.json scripts, Makefile, etc.) and run it.`,
    "push-pr": `## DELIVERABLE
PR URL + CI status.

## STOP CONDITION
Stop when: the PR is created.

## CONTEXT
Goal: {goal} | Branch: {branch}
Prior review summary: {review_summary}

1. Push branch to remote
2. Create PR via gh cli with title and body summarizing changes
3. Report PR URL`,
    "diff": `## DELIVERABLE
Files changed, lines added/removed, a summary of what each change does per area, and any concerns.

## STOP CONDITION
Stop when: the full diff analysis is complete.

## CONTEXT
Goal: {goal} | Branch: {branch}

Run: git diff main...HEAD (or appropriate base branch).`,
    "regression-qa": `## DELIVERABLE
Pass/fail + screenshot evidence + severity (CRITICAL/HIGH/MEDIUM/LOW) for each adjacent flow tested, ending with the line \`COVERAGE: <tested flows>\`.

## STOP CONDITION
Stop when: the required adjacent flows are covered OR two passes produce no new findings.

## CONTEXT
Goal: {goal} | Branch: {branch}

Use browser tools to test adjacent functionality — same core set as the qa phase (gstack_goto, gstack_snapshot, gstack_click, gstack_fill/gstack_type, gstack_wait, gstack_console --errors). Verify the fix didn't break other flows.`,
    "document": `## DELIVERABLE
A DOC REPORT block (files reviewed, updated, generated, remaining gaps) plus doc updates committed as their own atomic commit.

## STOP CONDITION
Stop when: every changed area has a Diataxis classification and the dictated factual updates are committed.

## CONTEXT
Goal: {goal} | Branch: {branch}

1. Analyze the branch diff against the base branch (git diff/log) and classify changes (new features / changed behavior / removed functionality)
2. Discover all markdown docs (maxdepth 2, excluding .git/node_modules/.gstack)
3. Build a Diataxis coverage map per changed area (tutorial / how-to / reference / explanation) and apply factual updates the diff dictates
4. Where docs are missing entirely, research the code (read implementations end-to-end + tests) and write them following Diataxis; write reference docs first
5. Sweep cross-doc consistency (versions, paths, counts, stale references)
6. Commit doc updates as their own atomic commit with a docs: prefix
7. Output the DOC REPORT block`,
    "update-docs": `## DELIVERABLE
A DOC REPORT block (files reviewed, updated, generated, remaining gaps) plus doc updates committed as their own atomic commit.

## STOP CONDITION
Stop when: every changed area has a Diataxis classification and the dictated factual updates are committed.

## CONTEXT
Goal: {goal} | Branch: {branch}

1. Analyze the branch diff against the base branch (git diff/log) and classify changes (new features / changed behavior / removed functionality)
2. Discover all markdown docs (maxdepth 2, excluding .git/node_modules/.gstack)
3. Build a Diataxis coverage map per changed area (tutorial / how-to / reference / explanation) and apply factual updates the diff dictates
4. Where docs are missing entirely, research the code (read implementations end-to-end + tests) and write them following Diataxis; write reference docs first
5. Sweep cross-doc consistency (versions, paths, counts, stale references)
6. Commit doc updates as their own atomic commit with a docs: prefix
7. Output the DOC REPORT block`,
  };

  let task = tasks[phase.id] ?? `Execute the "${phase.name}" phase for: {goal}. Use available tools and report results.`;
  const vd = phase.variant === "report-only"
    ? "\n\n**REPORT-ONLY MODE**: do NOT fix anything and do NOT commit. The report is the entire deliverable."
    : "";
  return buildTaskSkills(phase, task + vd);
}

/**
 * Embed the full distilled digests into a subagent task string. Subagent
 * processes have isolated contexts — embedding the methodology in the task is
 * the only reliable way for them to receive it.
 */
/**
 * Embed the full distilled digests into a subagent task string. Subagent
 * processes have isolated contexts — embedding the methodology in the task is
 * the only reliable way for them to receive it.
 */
// OUTPUT CONTRACT (STEP 2a): every specialist ends its work with a structured
// HANDOFF section so the next chain step receives verified facts, not a wall
// of text. Appended AFTER the METHODOLOGY block.
const OUTPUT_CONTRACT = `## OUTPUT CONTRACT
1. "## REPORT" — the full report in your role's format.
2. "## HANDOFF" (mandatory, ≤300 words, for the next specialist):
   - VERIFIED FACTS: confirmed facts only, each with evidence \`claim @ file:line\`
   - DECISIONS: choices made and why (one line each)
   - OPEN QUESTIONS: what remains open (or "none")
   - DO NOT REDO: what the next agent must NOT redo`;

function appendOutputContract(task: string): string {
  return `${task}\n\n---\n\n${OUTPUT_CONTRACT}`;
}

function buildTaskSkills(phase: WorkflowPhase, task: string, skillsOverride?: string[]): string {
  const ids = skillsOverride ?? phase.skills;
  if (!skillsEnabled() || !ids || ids.length === 0) {
    return appendOutputContract(task);
  }
  const blocks: string[] = [];
  for (const id of ids) {
    const digest = loadSkillDigest(id);
    const info = getSkillInfo(id);
    // Per-skill class prefix (STEP 1c): format-critical digests are part of
    // the deliverable; support digests are applied only as useful.
    const prefix = skillClassFor(id) === "format-critical" ? FORMAT_CRITICAL_PREFIX : SUPPORT_PREFIX;
    if (digest) {
      blocks.push(`## Skill methodology: ${id} (${skillClassFor(id)})\n${prefix}\n\n${digest}`);
    } else if (info?.fullPath) {
      blocks.push(`## Skill methodology: ${id} (${skillClassFor(id)})\n${prefix}\nBefore starting, read the file ${info.fullPath} and follow its methodology.`);
    }
  }
  if (blocks.length === 0) return appendOutputContract(task);
  // Fixed block order: the task (DELIVERABLE / STOP CONDITION / CONTEXT)
  // first, then METHODOLOGY, then the OUTPUT CONTRACT last.
  return `${task}\n\n---\n\n## METHODOLOGY\n\n${blocks.join("\n\n---\n\n")}\n\n---\n\n${OUTPUT_CONTRACT}`;
}

/**
 * Resolve the concrete subagent work for a phase: single agent or chain, with
 * all {goal}/{branch}/{*_summary} placeholders and skill methodology already
 * interpolated. Used by the deterministic executor to spawn subagents itself.
 */
// Scope boundaries keyed by phase id. The session debug of 2026-08-22 showed
// the reproduce phase drifting into full root-causing (the injected
// gstack-investigate digest contains the whole debugging methodology), which
// made the subsequent root-cause chain — and its manual approval gate — feel
// redundant to the user. These directives keep each phase inside its lane.
const PHASE_BOUNDARIES: Record<string, string> = {
  reproduce:
    "SCOPE BOUNDARY: This is the REPRODUCTION phase. Deliverable: a reliable, deterministic way to trigger the bug + precise symptoms. Briefly NOTE suspected causes if obvious, but do NOT deep-dive them, do NOT produce a full diagnosis, and do NOT change any files — that is the next phase's job.",
  "root-cause":
    "EFFICIENCY DIRECTIVE: Check the completed-phase summaries first. If a confirmed root cause already emerged during reproduction, VALIDATE it quickly against the code (confirm mechanism + affected files) instead of re-investigating from scratch, then report. Only widen the investigation if validation fails.",
};



export function scopeBoundaryFor(phaseId: string): string {
  return PHASE_BOUNDARIES[phaseId] ?? "";
}

export function buildDeterministicPlan(phase: WorkflowPhase, ctx: WorkflowContext): Array<{ agent: string; task: string }> {
  // STEP 4c: structural skip. If reproduction already CONFIRMED the root cause
  // (marker inside a valid HANDOFF, all cited files existing), collapse the
  // scout→planner chain to ONE validate-only planner step. The validate step
  // is never skippable and the workflow never collapses directly to fix.
  if (phase.id === "root-cause") {
    const marker = parseRootCauseMarker(
      extractHandoff(ctx.state.results["reproduce"]?.summary ?? "").text,
      ctx.cwd,
    );
    if (marker) {
      return [{ agent: "planner", task: interpolate(validateStrategyTask(marker), ctx) }];
    }
  }
  const boundary = scopeBoundaryFor(phase.id);
  const suffix = boundary ? `\n\n${boundary}` : "";
  if (phase.chain && phase.chain.length > 0) {
    // STEP 3c: each chain step resolves its own skill set (default: phase.skills).
    return phase.chain.map((step) => ({
      agent: step.agent,
      task: interpolate(buildTaskSkills(phase, step.task, step.skills ?? phase.skills), ctx) + suffix,
    }));
  }
  return [{ agent: phase.agent ?? "worker", task: interpolate(buildAgentTask(phase, ctx), ctx) + suffix }];
}

function interpolate(template: string, ctx: WorkflowContext): string {
  // $-safe (STEP 2c): untrusted values may contain `$&`, `$'`, `$1` etc.
  let out = replaceExact(template, /\{goal\}/g, ctx.state.goal);
  out = replaceExact(out, /\{branch\}/g, ctx.git.branch);
  out = replaceExact(out, /\{plan_file\}/g, planFilePath(ctx.state.goal));
  out = replaceExact(out, /\{(\w+)_summary\}/g, (_, phaseId: string) =>
    ctx.state.results[phaseId]?.summary ?? "(not yet available)");
  return out;
}
