import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState, PhaseResult } from "./types.ts";

const ENTRY_TYPE = "gstack-wf-state";

export function saveState(pi: ExtensionAPI, state: WorkflowState): void {
  pi.appendEntry(ENTRY_TYPE, state);
}

export function loadActiveState(ctx: ExtensionContext): WorkflowState | null {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as any;
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      const state = entry.data as WorkflowState;
      if (
        state &&
        (state.status === "active" || state.status === "paused" || state.status === "awaiting_approval")
      ) {
        return state;
      }
      return null;
    }
  }
  return null;
}

export function createState(workflowId: string, goal: string): WorkflowState {
  return {
    workflowId,
    phaseIndex: 0,
    status: "active",
    goal,
    results: {},
  };
}

export function advancePhase(state: WorkflowState, phaseId: string, result: PhaseResult, totalPhases: number): WorkflowState {
  const next: WorkflowState = {
    ...state,
    results: { ...state.results, [phaseId]: result },
  };

  if (result.status === "failed") {
    next.status = "paused";
    return next;
  }

  const nextIndex = state.phaseIndex + 1;
  if (nextIndex >= totalPhases) {
    next.status = "completed";
  } else {
    next.phaseIndex = nextIndex;
    // Caller decides whether the next phase starts immediately ("active") or
    // waits for user approval ("awaiting_approval") — see gateForApproval().
  }

  return next;
}

/**
 * When the just-completed phase is a manual-gate phase, park the workflow in
 * awaiting_approval. The phaseIndex already points at the next phase so
 * approval (/gstack next) simply resumes execution.
 */
export function gateForApproval(state: WorkflowState): WorkflowState {
  if (state.status !== "active") return state;
  return { ...state, status: "awaiting_approval" };
}

/** Approve a gated workflow: resume normal execution at the pending phase. */
export function approveNext(state: WorkflowState): WorkflowState {
  if (state.status !== "awaiting_approval") return state;
  return { ...state, status: "active" };
}

export function pauseState(state: WorkflowState): WorkflowState {
  return { ...state, status: "paused" };
}

export function abortState(state: WorkflowState): WorkflowState {
  return { ...state, status: "aborted" };
}

export function resumeState(state: WorkflowState): WorkflowState {
  return { ...state, status: "active" };
}
