import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState, WorkflowContext, GitContext } from "./types.ts";
import { getWorkflow } from "./workflows.ts";
import { saveState, advancePhase, gateForApproval } from "./state.ts";
import { buildPhaseInstructions, buildDeterministicPlan } from "./templates.ts";
import { detectGitContext } from "./git.ts";
import { runSubagent, type SpawnRequest, type SpawnResult, defaultTimeoutMs } from "./spawn.ts";
import { deterministicSubagents, skillsEnabled, optionalPhases, maxRunTokens, delegationBudgetMs } from "./config.ts";
import { ensureRun, recordDelegatedStep, writeRunReport, recordLiveness, recordTokens, totalTokensUsed } from "./telemetry.ts";
import { extractHandoff } from "./handoff.ts";
import { isRefutedStrategy } from "./skip.ts";
import { replaceExact } from "./text.ts";

// --- Sequential-chain resilience (STEP 2f) -----------------------------------

/** Delay before the single allowed retry of a transient chain-step failure.
 * Timeouts get a long cooldown (give the provider room to recover); fast
 * failures are usually transient provider hiccups — retry quickly instead of
 * burning 30s on every blip. */
export const RETRY_DELAY_MS = 30_000;
export const FAST_RETRY_DELAY_MS = 5_000;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transient failures may recover on a single retry: timeout, abort, or a
 * non-zero exit without any output. Configuration errors (unknown agent,
 * spawn ENOENT, bad setup) are HARD and propagate immediately.
 */
export function isTransientFailure(result: SpawnResult): boolean {
  if (result.ok) return false;
  if (result.configError) return false;
  if (result.timedOut) return true;
  return (result.exitCode ?? 1) !== 0 && !result.output;
}

/**
 * Decision for attempt N (1-based). At most one retry is allowed; it runs
 * with a +50% timeout limit and a failure-class-dependent cooldown.
 */
export function retryDecision(result: SpawnResult, attempt: number): { retry: boolean; timeoutScale: number; delayMs: number } {
  if (attempt >= 2 || !isTransientFailure(result)) {
    return { retry: false, timeoutScale: 1, delayMs: 0 };
  }
  return {
    retry: true,
    timeoutScale: 1.5,
    delayMs: result.timedOut ? RETRY_DELAY_MS : FAST_RETRY_DELAY_MS,
  };
}

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
 * Persistent breadcrumb for delegation milestones. Written as a session
 * entry so progress and failures survive crashes and exports — the field
 * lesson from the 2026-08-23 incident was total silence between the advance
 * and the host crash. Best-effort by design: telemetry must never kill the
 * chain (and every callback that could throw is guarded at its source).
 */
function delegationEvent(pi: ExtensionAPI, data: Record<string, unknown>): void {
  try {
    pi.appendEntry("gstack-delegation-event", { at: new Date().toISOString(), ...data });
  } catch {
    /* best-effort */
  }
}

/**
 * Crash forensics: if a previous run died mid-delegation (host killed by an
 * uncaught exception), the last delegation event never reached a terminal
 * state. Annotate it so the restart has an explicit trail instead of silence.
 */
export function annotateOrphanedDelegation(pi: ExtensionAPI, ctx: ExtensionContext): void {
  try {
    const entries = ((ctx.sessionManager as any)?.getEntries?.() ?? []) as any[];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e?.type === "custom" && e.customType === "gstack-delegation-event") {
        if (e.data?.event === "started" || e.data?.event === "retrying") {
          delegationEvent(pi, {
            phaseId: e.data.phaseId,
            agent: e.data.agent,
            event: "interrupted",
            detail: "previous run ended mid-delegation (host restart?)",
          });
        }
        break;
      }
    }
  } catch {
    /* best-effort */
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
  // STEP 0 telemetry: make sure this run is being accumulated.
  ensureRun(state.workflowId);
  // Crash forensics: annotate a delegation that never reached a terminal
  // event in the previous run (host died mid-flight).
  annotateOrphanedDelegation(pi, ctx);

  const phase = workflow.phases[state.phaseIndex];
  if (!phase) {
    // Workflow completed: flush the structured run report (STEP 0 telemetry).
    writeRunReport(ctx.cwd, state.workflowId);
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
    // STEP 2g: optional phases must never be abandoned silently. In
    // fire-and-forget background runs a stale-context prompt failure now
    // records `skipped` in state; GSTACK_PI_OPTIONAL_PHASES=auto|skip avoids
    // the prompt entirely for background execution.
    const mode = optionalPhases();
    let run: boolean;
    if (mode === "auto") {
      run = true;
    } else if (mode === "skip") {
      run = false;
    } else {
      try {
        run = await ctx.ui.confirm(
          `Optional phase: ${phase.name}`,
          `Run the "${phase.name}" phase? (Skip to continue without it)`,
        );
      } catch {
        const skipped = advancePhase(
          state,
          phase.id,
          { status: "skipped", summary: "Auto-skipped: approval prompt unavailable (stale context)" },
          workflow.phases.length,
        );
        saveState(pi, skipped);
        notify(`gstack: optional phase "${phase.name}" recorded as skipped (prompt unavailable).`, "warning");
        return executeCurrentPhase(pi, ctx, skipped);
      }
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
    const results = await runDeterministicDelegation(phase, wfCtx, ctx, alive, pi);
    if (!alive()) return;
    // STEP 0 telemetry: persist per-step measurements (persistence only —
    // every number already exists on SpawnResult).
    for (const [stepIndex, { agent, result }] of results.entries()) {
      recordDelegatedStep({
        phaseId: phase.id,
        stepIndex,
        agent,
        durationMs: result.durationMs,
        toolCalls: result.toolCalls,
        turns: result.turns,
        tokensIn: result.usage?.input,
        tokensCacheRead: result.usage?.cacheRead,
        tokensOut: result.usage?.output,
        timeoutClass: "default",
      });
    }
    delegationPrefix = formatDelegationResults(phase.id, results);
    // STEP 4d: make the skip outcome explicit in what the model reviews.
    if (phase.id === "root-cause" && results.length > 0) {
      const lastOutput = results[results.length - 1].result.output ?? "";
      if (/^REFUTED:/im.test(lastOutput)) {
        delegationPrefix += "\n\n[root-cause outcome: refuted→full-reinvestigation]";
      } else if (/^VALIDATED:/im.test(lastOutput)) {
        delegationPrefix += "\n\n[root-cause outcome: validated]";
      }
    }
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
  pi: ExtensionAPI,
): Promise<Array<{ agent: string; result: SpawnResult }>> {
  const plan = buildDeterministicPlan(phase as any, wfCtx);
  // STEP 4d: a collapsed validate-only root-cause step may be REFUTED — then
  // the FULL original scout→planner chain is rebuilt and re-run.
  const wasCollapsed =
    phase.id === "root-cause" && plan.length === 1 && plan[0].agent === "planner";

  // Wall-clock guard (STEP D3): one phase's whole delegation must never hang
  // forever — past the budget the chain stops orderly with a visible trail.
  const budget = delegationBudgetMs();
  const delegationStart = Date.now();

  const runSteps = async (
    steps: Array<{ agent: string; task: string }>,
  ): Promise<Array<{ agent: string; result: SpawnResult }>> => {
    const out: Array<{ agent: string; result: SpawnResult }> = [];
    let previous = "";
    let prevIncomplete = false;
    for (const [index, step] of steps.entries()) {
      if (!alive()) break; // session reloaded mid-chain — stop spawning work
      if (budget !== "off" && Date.now() - delegationStart > budget) {
        delegationEvent(pi, {
          phaseId: phase.id,
          step: index,
          agent: step.agent,
          event: "budget-exceeded",
          budgetSec: Math.round((budget as number) / 1000),
        });
        try {
          ctx.ui.notify(
            `gstack: delegation wall-clock budget (${Math.round((budget as number) / 1000)}s) exhausted — stopping phase "${phase.id}" before "${step.agent}".`,
            "warning",
          );
        } catch {
          /* stale ctx */
        }
        break;
      }
      // STEP 2c: the receiver gets the extracted HANDOFF (computed on the RAW
      // uncapped upstream output), never the entire report — a full 50K-char
      // payload inflated every downstream turn's prefill and encouraged
      // re-verification of already-settled facts.
      const handoff = extractHandoff(previous, { incomplete: prevIncomplete });
      const task = replaceExact(step.task, /\{previous\}/g, handoff.text || "(no prior output)");
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
            `subagent ${step.agent} (${index + 1}/${steps.length}) · ${secs}s — ${extra}`,
          );
        } catch {
          /* stale ctx */
        }
      };
      setStatus("starting…");

      const req: SpawnRequest = {
        agent: step.agent,
        task,
        cwd: wfCtx.cwd,
        // STEP 5a: per-class timeout resolved from the phase id.
        phaseId: phase.id,
        shouldAbort: () => !alive(),
        onActivity: setStatus,
        // STEP 5b: observe-only liveness — dual sink (notify + run report).
        onLiveness: (obs) => {
          recordLiveness(obs);
          try {
            ctx.ui.notify(
              `[liveness-observe] would abort '${obs.agent}' after ${obs.gapSec}s of silence (last event: ${obs.lastEvent}, tool: ${obs.lastTool ?? "n/a"})`,
              "warning",
            );
          } catch {
            /* stale ctx */
          }
        },
      };
      delegationEvent(pi, { phaseId: phase.id, step: index, agent: step.agent, event: "started" });
      // STEP 2f/4d: at most one retry for transient failures; the cooldown
      // depends on the failure class (timeout → long, fast blip → short).
      let result = await runSubagent(req);
      const decision = retryDecision(result, 1);
      if (decision.retry && alive()) {
        delegationEvent(pi, {
          phaseId: phase.id,
          step: index,
          agent: step.agent,
          event: "retrying",
          reason: result.timedOut ? "timeout" : `exit ${result.exitCode}`,
          delaySec: Math.round(decision.delayMs / 1000),
        });
        try {
          ctx.ui.notify(
            `gstack: subagent "${step.agent}" failed transiently (${result.timedOut ? "timeout" : `exit ${result.exitCode}`}) — retrying once in ${Math.round(decision.delayMs / 1000)}s with a raised limit…`,
            "warning",
          );
        } catch {
          /* stale ctx */
        }
        await delay(decision.delayMs);
        if (alive()) {
          result = await runSubagent({
            ...req,
            timeoutMs: Math.round((req.timeoutMs ?? defaultTimeoutMs()) * decision.timeoutScale),
          });
        }
      }
      out.push({ agent: step.agent, result });
      delegationEvent(pi, {
        phaseId: phase.id,
        step: index,
        agent: step.agent,
        event: result.ok ? "completed" : result.timedOut ? "timeout" : "failed",
        durationSec: Math.round(result.durationMs / 1000),
        toolCalls: result.toolCalls,
        turns: result.turns,
        incomplete: result.incomplete === true || undefined,
        error: result.error ? String(result.error).slice(0, 300) : undefined,
      });
      previous = result.rawOutput ?? (result.output || result.error || "");
      prevIncomplete = !result.ok || result.incomplete === true;
      // STEP 5c: token budget circuit-breaker — notify + orderly stop, no kill.
      const used =
        (result.usage?.input ?? 0) + (result.usage?.cacheRead ?? 0) + (result.usage?.output ?? 0);
      recordTokens(used);
      if (totalTokensUsed() > maxRunTokens()) {
        try {
          ctx.ui.notify(
            `gstack: GSTACK_PI_MAX_RUN_TOKENS exceeded (${totalTokensUsed()} tokens) — stopping the chain orderly.`,
            "warning",
          );
        } catch {
          /* stale ctx */
        }
        break;
      }
    }
    return out;
  };

  const out = await runSteps(plan);

  // STEP 4d — mandatory reopen path: REFUTED validation → run the FULL
  // original chain, prefixing the scout so it does not revisit the dead end.
  if (wasCollapsed && out.length > 0 && isRefutedStrategy(out[out.length - 1].result.output ?? "")) {
    try {
      ctx.ui.notify("gstack: root-cause hypothesis REFUTED by validation — rebuilding the full investigation chain.", "warning");
    } catch {
      /* stale ctx */
    }
    const refutedText = out[out.length - 1].result.output ?? "";
    const causeMatch = /CONFIRMED this cause: "(.+?)" \(files?:/.exec(plan[0].task);
    const reasonMatch = /^REFUTED:\s*(.+)$/im.exec(refutedText);
    const freshCtx: WorkflowContext = {
      ...wfCtx,
      state: { ...wfCtx.state, results: { ...wfCtx.state.results } },
    };
    delete freshCtx.state.results["reproduce"];
    const fullPlan = buildDeterministicPlan(phase as any, freshCtx);
    if (fullPlan.length > 0 && causeMatch) {
      const note = `NOTE: the hypothesis '${causeMatch[1]}' was REFUTED because: ${reasonMatch?.[1]?.trim() ?? "validation against the code failed"}. Do not revisit it.\n\n`;
      fullPlan[0] = { ...fullPlan[0], task: replaceExact(fullPlan[0].task, /^/, note) };
      return [...out, ...(await runSteps(fullPlan))];
    }
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
      const secs = Math.round(result.durationMs / 1000);
      const turns = result.turns ?? 0;
      const avgTurn = turns > 0 ? `${(result.durationMs / turns / 1000).toFixed(1)}s/turn` : "n/a";
      const tok = result.usage
        ? `tokens in ${result.usage.input} (cache ${result.usage.cacheRead}) out ${result.usage.output}`
        : "tokens n/a";
      // STEP 2c: make the handoff quality visible for every step.
      let handoffSuffix = "";
      if (result.ok) {
        const level = extractHandoff(result.rawOutput ?? result.output ?? "", { incomplete: result.incomplete }).level;
        handoffSuffix = ` · handoff: ${level}`;
        if (result.incomplete) {
          handoffSuffix += `, output INCOMPLETE (${result.timedOut ? "timed out" : "partial output"})`;
        }
      }
      parts.push(`### Subagent: ${agent} — ${result.ok ? "completed" : "FAILED"} (${secs}s · ${result.toolCalls ?? "?"} tool calls · ${turns} turns · ${avgTurn}${handoffSuffix} · ${tok})`);
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
