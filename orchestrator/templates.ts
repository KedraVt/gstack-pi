import type { WorkflowPhase, WorkflowContext, Workflow } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { loadSkillDigest, getSkillInfo } from "./skills.ts";
import { skillsEnabled, manualGates } from "./config.ts";

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
  } else {
    parts.push(buildSubagentInstructions(phase, ctx));
  }

  const skillBlock = buildSkillBlock(phase);
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
  ];
  if (manualGates() && phase.advance === "manual") {
    lines.push(
      "This phase is a DECISION PHASE: after you call gstack_advance, the workflow will pause so the user can review your output before the next phase starts. Present your results clearly and completely — the user's approval depends on them.",
    );
  }
  lines.push("If the phase failed, use status \"failed\" and explain why.");
  return lines.join("\n");
}

/**
 * Skill methodology injection. The orchestrator decides when skill knowledge
 * applies and embeds the distilled digest directly — the agent does not need
 * to know whether a skill should be loaded.
 */
function buildSkillBlock(phase: WorkflowPhase): string | null {
  if (!skillsEnabled() || !phase.skill) return null;
  const digest = loadSkillDigest(phase.skill);
  const info = getSkillInfo(phase.skill);
  const parts: string[] = ["### Skill methodology: " + phase.skill];
  if (digest) {
    parts.push(digest);
  } else if (info) {
    // Graceful degradation: digest missing → point at the full skill doc.
    parts.push(`Read and follow the full methodology at: ${info.fullPath}`);
  } else {
    return null;
  }
  if (info) {
    parts.push(`(Full skill documentation for deep consultation: ${info.fullPath})`);
  }
  return parts.join("\n");
}

function buildMainInstructions(phase: WorkflowPhase, ctx: WorkflowContext): string {
  const templates: Record<string, (ctx: WorkflowContext) => string> = {
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
  if (builder) return builder(ctx);

  return [
    "### Instructions",
    `Execute the "${phase.name}" phase for goal: "${ctx.state.goal}"`,
    "Use available tools to accomplish this phase.",
    "Focus on producing a clear, actionable result.",
  ].join("\n");
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
        task: interpolate(step.task, ctx),
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
  const tasks: Record<string, string> = {
    "implement": `Implement the following feature/plan: {goal}.\n\nContext from prior phases:\n{plan_summary}\n\nWrite production-quality code. Run tests after implementation. Report what was implemented and any issues.`,
    "qa": `QA test the following: {goal}.\n\nUse the gstack browser tools (gstack_goto, gstack_snapshot, gstack_click, gstack_screenshot, etc.) to test user flows. Take screenshots as evidence. Report all bugs found with severity.`,
    "review": `Review the code changes for: {goal}.\n\nRun git diff to see changes. Check for: bugs, security issues, performance problems, style violations, missing tests. Report findings categorized by severity.`,
    "ship": `Ship the current changes: {goal}.\n\n1. Ensure all changes are committed\n2. Push to remote\n3. Create a PR with a clear title and description\n4. Report the PR URL and any CI status`,
    "fix": `Fix the issues found: {goal}.\n\nPrior findings:\n{findings_summary}\n\nApply minimal, targeted fixes. Run tests after each fix. Report what was fixed.`,
    "test": `Run the full test suite for this project.\n\nIdentify the test command (package.json scripts, Makefile, etc.) and run it. Report: pass/fail counts, any failures with details.`,
    "push-pr": `Push current branch and create a pull request.\n\nGoal context: {goal}\nPrior review summary: {review_summary}\n\n1. Push branch to remote\n2. Create PR via gh cli with title and body summarizing changes\n3. Report PR URL`,
    "diff": `Analyze the git diff for this branch.\n\nRun: git diff main...HEAD (or appropriate base branch).\nReport: files changed, lines added/removed, summary of what each change does, any concerns.`,
    "regression-qa": `Run regression QA after a bug fix: {goal}.\n\nUse browser tools to test adjacent functionality. Verify the fix didn't break other flows. Report findings.`,
  };

  let task = tasks[phase.id] ?? `Execute the "${phase.name}" phase for: {goal}. Use available tools and report results.`;
  const withSkill = withSkillDigest(phase, task);
  return withSkill;
}

/**
 * Prepend the distilled skill digest to a subagent task string. Subagent
 * processes have isolated contexts — embedding the methodology in the task is
 * the only reliable way for them to receive it.
 */
function withSkillDigest(phase: WorkflowPhase, task: string): string {
  if (!skillsEnabled() || !phase.skill) return task;
  const digest = loadSkillDigest(phase.skill);
  const info = getSkillInfo(phase.skill);
  if (digest) {
    return `## Skill methodology: ${phase.skill} (follow this methodology; its output format is mandatory)\n\n${digest}\n\n---\n\n${task}`;
  }
  if (info) {
    return `Before starting, read the file ${info.fullPath} and follow its methodology. Its output format is mandatory.\n\n${task}`;
  }
  return task;
}

/**
 * Resolve the concrete subagent work for a phase: single agent or chain, with
 * all {goal}/{branch}/{*_summary} placeholders and skill methodology already
 * interpolated. Used by the deterministic executor to spawn subagents itself.
 */
export function buildDeterministicPlan(phase: WorkflowPhase, ctx: WorkflowContext): Array<{ agent: string; task: string }> {
  if (phase.chain && phase.chain.length > 0) {
    return phase.chain.map((step) => ({
      agent: step.agent,
      task: interpolate(step.task, ctx),
    }));
  }
  return [{ agent: phase.agent ?? "worker", task: interpolate(buildAgentTask(phase, ctx), ctx) }];
}

function interpolate(template: string, ctx: WorkflowContext): string {
  return template
    .replace(/\{goal\}/g, ctx.state.goal)
    .replace(/\{branch\}/g, ctx.git.branch)
    .replace(/\{(\w+)_summary\}/g, (_, phaseId: string) =>
      ctx.state.results[phaseId]?.summary ?? "(not yet available)");
}
