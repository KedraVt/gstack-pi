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
      if (state && (state.status === "active" || state.status === "paused")) {
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
  }

  return next;
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
