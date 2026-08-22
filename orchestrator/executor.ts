import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState, WorkflowContext, GitContext } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { saveState, advancePhase, gateForApproval } from "./state.ts";
import { buildPhaseInstructions, buildDeterministicPlan } from "./templates.ts";
import { detectGitContext } from "./git.ts";
import { runSubagent, type SpawnResult } from "./spawn.ts";
import { deterministicSubagents } from "./config.ts";

export async function executeCurrentPhase(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: WorkflowState,
): Promise<void> {
  const workflow = getWorkflow(state.workflowId);
  if (!workflow) {
    ctx.ui.notify(`Unknown workflow: ${state.workflowId}`, "error");
    return;
  }

  const phase = workflow.phases[state.phaseIndex];
  if (!phase) {
    saveState(pi, { ...state, status: "completed" });
    ctx.ui.setStatus("gstack", undefined);
    ctx.ui.notify(`Workflow "${workflow.name}" completed!`, "info");
    return;
  }

  const git = await detectGitContext(ctx.cwd, pi);
  const wfCtx: WorkflowContext = { state, git, cwd: ctx.cwd };

  if (phase.skipWhen?.(wfCtx)) {
    const skipped = advancePhase(state, phase.id, { status: "skipped", summary: "Auto-skipped by condition" }, workflow.phases.length);
    saveState(pi, skipped);
    return executeCurrentPhase(pi, ctx, skipped);
  }

  if (phase.optional) {
    const run = await ctx.ui.confirm(
      `Optional phase: ${phase.name}`,
      `Run the "${phase.name}" phase? (Skip to continue without it)`,
    );
    if (!run) {
      const skipped = advancePhase(state, phase.id, { status: "skipped", summary: "Skipped by user" }, workflow.phases.length);
      saveState(pi, skipped);
      return executeCurrentPhase(pi, ctx, skipped);
    }
  }

  ctx.ui.setStatus("gstack", `${workflow.name}: ${phase.name} (${state.phaseIndex + 1}/${workflow.phases.length})`);

  // Deterministic mode: the executor spawns subagents itself for subagent
  // phases. Delegation no longer depends on the model choosing to call the
  // `subagent` tool — it happens by construction.
  let delegationPrefix = "";
  if (deterministicSubagents() && phase.execution === "subagent") {
    const results = await runDeterministicDelegation(phase, wfCtx, ctx);
    delegationPrefix = formatDelegationResults(phase.id, results);
  }

  const instructions = buildPhaseInstructions(phase, wfCtx);
  // The executor runs inside tool/command handlers while the agent loop is
  // streaming. pi requires an explicit delivery behavior in that case, or it
  // throws "Agent is already processing. Specify streamingBehavior..." and the
  // phase instructions are silently lost. "followUp" queues them as a fresh
  // message after the current turn completes — the correct handoff semantic.
  pi.sendUserMessage(delegationPrefix + instructions, { deliverAs: "followUp" });
}

async function runDeterministicDelegation(
  phase: { id: string },
  wfCtx: WorkflowContext,
  ctx: ExtensionContext,
): Promise<Array<{ agent: string; result: SpawnResult }>> {
  const plan = buildDeterministicPlan(phase as any, wfCtx);
  const out: Array<{ agent: string; result: SpawnResult }> = [];
  let previous = "";
  for (const step of plan) {
    const task = step.task.replace(/\{previous\}/g, previous || "(no prior output)");
    ctx.ui.notify(`gstack: running subagent "${step.agent}"…`, "info");
    const result = await runSubagent({ agent: step.agent, task, cwd: wfCtx.cwd });
    out.push({ agent: step.agent, result });
    previous = result.output || result.error || "";
  }
  return out;
}

function workflowPhaseOf(wfCtx: WorkflowContext, phaseId: string): any {
  const wf = getWorkflow(wfCtx.state.workflowId);
  return wf?.phases.find((p) => p.id === phaseId) ?? {};
}

function formatDelegationResults(
  phaseId: string,
  results: Array<{ agent: string; result: SpawnResult }>,
): string {
  const parts: string[] = [`## Subagent execution complete (phase: ${phaseId})`];
  parts.push("The work below was already performed by dedicated subagent processes spawned by the orchestrator.");
  parts.push("Review their outputs, then call gstack_advance with your summary. Do NOT redo the delegated work unless a result is clearly wrong or incomplete.");
  for (const { agent, result } of results) {
    parts.push("");
    parts.push(`### Subagent: ${agent} — ${result.ok ? "completed" : "FAILED"} (${Math.round(result.durationMs / 1000)}s)`);
    if (result.ok) {
      parts.push(result.output || "(no textual output)");
    } else {
      parts.push(`Error: ${result.error ?? "unknown error"} (exit code ${result.exitCode}). Decide whether to retry the work yourself or report the failure via gstack_advance with status "failed".`);
    }
  }
  parts.push("");
  return parts.join("\n");
}

export function buildResumeContext(state: WorkflowState): string {
  const workflow = getWorkflow(state.workflowId);
  if (!workflow) return "";

  const phase = workflow.phases[state.phaseIndex];
  const parts: string[] = [];
  parts.push(`[gstack workflow active: ${workflow.name}]`);
  parts.push(`Current phase: ${phase?.name ?? "unknown"} (${state.phaseIndex + 1}/${workflow.phases.length})`);
  parts.push(`Goal: ${state.goal}`);

  const completed = Object.entries(state.results).filter(([, r]) => r.status === "completed");
  if (completed.length > 0) {
    parts.push(`Completed: ${completed.map(([id]) => id).join(", ")}`);
  }

  parts.push("Continue working on the current phase. Call gstack_advance when done.");
  return parts.join("\n");
}
