import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState, WorkflowContext, GitContext } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { saveState, advancePhase } from "./state.ts";
import { buildPhaseInstructions } from "./templates.ts";
import { detectGitContext } from "./git.ts";

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

  const instructions = buildPhaseInstructions(phase, wfCtx);
  pi.sendUserMessage(instructions);
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
