import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState, WorkflowContext, GitContext } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { saveState, advancePhase, gateForApproval } from "./state.ts";
import { buildPhaseInstructions, buildDeterministicPlan } from "./templates.ts";
import { detectGitContext } from "./git.ts";
import { runSubagent, type SpawnResult } from "./spawn.ts";
import { deterministicSubagents, skillsEnabled } from "./config.ts";

// --- Runtime liveness -------------------------------------------------------
// Background phase chains (deterministic subagent runs) intentionally outlive
// the tool/command handler that started them. But if the user reloads the
// session mid-chain, pi invalidates the captured ExtensionContext; ANY later
// ctx.ui access then throws "Extension ctx is stale…" and, being uncaught in a
// floating promise, kills pi entirely (uncaughtException). These guards make
// staleness detectable and non-fatal.

/** Bumped whenever the session is replaced/reloaded/forked. */
let runtimeEpoch = 0;

export function invalidateRuntime(): void {
  runtimeEpoch++;
}

/**
 * Probe whether this context is still valid. Merely touching the `ui` getter
 * triggers pi's assertActive(), which throws on stale contexts.
 */
export function ctxAlive(ctx: unknown): boolean {
  try {
    void (ctx as any).ui;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget phase execution. Errors are never allowed to become
 * uncaught rejections: stale-context failures are dropped silently, anything
 * else is reported best-effort (the report itself is guarded against a stale
 * context).
 */
export function launchPhase(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: WorkflowState,
  run: (pi: ExtensionAPI, ctx: ExtensionContext, state: WorkflowState) => Promise<void> = executeCurrentPhase,
): void {
  void run(pi, ctx, state).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/stale/i.test(msg)) return;
    try {
      ctx.ui.notify(`gstack error: ${msg}`, "error");
    } catch {
      /* context went stale while reporting — nothing left to do */
    }
  });
}

export async function executeCurrentPhase(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: WorkflowState,
): Promise<void> {
  const startEpoch = runtimeEpoch;
  const alive = (): boolean => runtimeEpoch === startEpoch && ctxAlive(ctx);
  const notify = (msg: string, level: "info" | "warning" | "error") => {
    try {
      ctx.ui.notify(msg, level);
    } catch {
      /* stale ctx — drop the notification rather than crash */
    }
  };

  if (!alive()) return;

  const workflow = getWorkflow(state.workflowId);
  if (!workflow) {
    notify(`Unknown workflow: ${state.workflowId}`, "error");
    return;
  }

  const phase = workflow.phases[state.phaseIndex];
  if (!phase) {
    saveState(pi, { ...state, status: "completed" });
    try {
      ctx.ui.setStatus("gstack", undefined);
    } catch {
      /* stale ctx */
    }
    notify(`Workflow "${workflow.name}" completed!`, "info");
    return;
  }

  const git = await detectGitContext(ctx.cwd, pi);
  if (!alive()) return;
  const wfCtx: WorkflowContext = { state, git, cwd: ctx.cwd };

  if (phase.skipWhen?.(wfCtx)) {
    const skipped = advancePhase(state, phase.id, { status: "skipped", summary: "Auto-skipped by condition" }, workflow.phases.length);
    saveState(pi, skipped);
    return executeCurrentPhase(pi, ctx, skipped);
  }

  if (phase.optional) {
    let run: boolean;
    try {
      run = await ctx.ui.confirm(
        `Optional phase: ${phase.name}`,
        `Run the "${phase.name}" phase? (Skip to continue without it)`,
      );
    } catch {
      return; // context went stale mid-prompt — abandon this chain silently
    }
    if (!alive()) return;
    if (!run) {
      const skipped = advancePhase(state, phase.id, { status: "skipped", summary: "Skipped by user" }, workflow.phases.length);
      saveState(pi, skipped);
      return executeCurrentPhase(pi, ctx, skipped);
    }
  }

  try {
    ctx.ui.setStatus("gstack", `${workflow.name}: ${phase.name} (${state.phaseIndex + 1}/${workflow.phases.length})`);
  } catch {
    /* stale ctx */
  }

  // Deterministic mode: the executor spawns subagents itself for subagent
  // phases. Delegation no longer depends on the model choosing to call the
  // `subagent` tool — it happens by construction.
  let delegationPrefix = "";
  if (deterministicSubagents() && phase.execution === "subagent") {
    const results = await runDeterministicDelegation(phase, wfCtx, ctx, alive);
    if (!alive()) return;
    delegationPrefix = formatDelegationResults(phase.id, results);
    // Restore the phase status line (delegation left subagent progress there).
    try {
      ctx.ui.setStatus("gstack", `${workflow.name}: ${phase.name} (${state.phaseIndex + 1}/${workflow.phases.length})`);
    } catch {
      /* stale ctx */
    }
  }

  const instructions = buildPhaseInstructions(phase, wfCtx);

  // Record that this run has now DELIVERED these skill digests in full, so
  // later phases of the same skill degrade to their compact DoD gate.
  if (skillsEnabled() && phase.execution === "main" && phase.skills && phase.skills.length > 0) {
    const delivered = new Set([...(state.skillsDelivered ?? []), ...phase.skills]);
    const updated = { ...state, skillsDelivered: Array.from(delivered) };
    saveState(pi, updated);
  }

  // The executor runs inside tool/command handlers while the agent loop is
  // streaming. pi requires an explicit delivery behavior in that case, or it
  // throws "Agent is already processing. Specify streamingBehavior..." and the
  // phase instructions are silently lost. "followUp" queues them as a fresh
  // message after the current turn completes — the correct handoff semantic.
  try {
    pi.sendUserMessage(delegationPrefix + instructions, { deliverAs: "followUp" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/stale/i.test(msg)) notify(`gstack: failed to deliver phase instructions: ${msg}`, "error");
  }
}

async function runDeterministicDelegation(
  phase: { id: string },
  wfCtx: WorkflowContext,
  ctx: ExtensionContext,
  alive: () => boolean,
): Promise<Array<{ agent: string; result: SpawnResult }>> {
  const plan = buildDeterministicPlan(phase as any, wfCtx);
  const out: Array<{ agent: string; result: SpawnResult }> = [];
  let previous = "";
  for (const [index, step] of plan.entries()) {
    if (!alive()) break; // session reloaded mid-chain — stop spawning work
    // Cap the handoff payload: a full 50K-char upstream report inflates every
    // downstream turn's prefill and encourages re-exploration. The orchestrator
    // still receives the FULL output; specialists get the head of it.
    const PREVIOUS_CAP = 12000;
    const previousForTask =
      previous.length > PREVIOUS_CAP
        ? `${previous.slice(0, PREVIOUS_CAP)}\n…(handoff truncated at ${PREVIOUS_CAP} chars — full report available in phase summary)`
        : previous;
    const task = step.task.replace(/\{previous\}/g, previousForTask || "(no prior output)");
    try {
      ctx.ui.notify(`gstack: running subagent "${step.agent}"…`, "info");
    } catch {
      /* stale ctx — keep working, notifications are best-effort */
    }

    // Live progress in the status bar (deterministic spawns have no tool
    // renderer, so the status line is the real-time view).
    const stepStart = Date.now();
    const setStatus = (extra: string) => {
      try {
        const secs = Math.round((Date.now() - stepStart) / 1000);
        ctx.ui.setStatus(
          "gstack",
          `subagent ${step.agent} (${index + 1}/${plan.length}) · ${secs}s — ${extra}`,
        );
      } catch {
        /* stale ctx */
      }
    };
    setStatus("starting…");

    const result = await runSubagent({
      agent: step.agent,
      task,
      cwd: wfCtx.cwd,
      shouldAbort: () => !alive(),
      onActivity: setStatus,
    });
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
    parts.push(`### Subagent: ${agent} — ${result.ok ? "completed" : "FAILED"} (${Math.round(result.durationMs / 1000)}s, ${result.toolCalls ?? "?"} tool calls)`);
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
