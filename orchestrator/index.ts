import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { handleGstackCommand, getCompletions } from "./command.ts";
import { createInputRouter } from "./router.ts";
import { loadActiveState, saveState, advancePhase } from "./state.ts";
import { getWorkflow } from "./workflows.ts";
import { executeCurrentPhase } from "./executor.ts";

export function initOrchestrator(pi: ExtensionAPI): void {
  pi.registerCommand("gstack", {
    description: "Guided workflow orchestrator: develop, investigate, qa, ship, review",
    getArgumentCompletions: getCompletions,
    handler: async (args: string, ctx) => {
      await handleGstackCommand(args, ctx as any, pi);
    },
  });

  pi.on("input", createInputRouter(pi) as any);

  pi.registerTool({
    name: "gstack_advance",
    label: "Advance Workflow",
    description: "Signal completion of the current gstack workflow phase. Call this when you finish a phase to advance to the next one.",
    promptSnippet: "Advance the active gstack workflow to the next phase",
    promptGuidelines: [
      "Only call gstack_advance when a gstack workflow phase is active",
      "Provide a concise 2-3 sentence summary of what was accomplished",
      "Use status 'failed' if the phase could not be completed",
    ],
    parameters: Type.Object({
      summary: Type.String({ description: "2-3 sentence summary of what was accomplished in this phase" }),
      status: Type.Union([Type.Literal("completed"), Type.Literal("failed")], { description: "Whether the phase succeeded or failed" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const state = loadActiveState(ctx);
      if (!state) {
        return { content: [{ type: "text" as const, text: "No active gstack workflow. Start one with /gstack." }] };
      }

      const workflow = getWorkflow(state.workflowId);
      if (!workflow) {
        return { content: [{ type: "text" as const, text: `Unknown workflow: ${state.workflowId}` }], isError: true };
      }

      const phase = workflow.phases[state.phaseIndex];
      const newState = advancePhase(
        state,
        phase.id,
        { status: params.status, summary: params.summary },
        workflow.phases.length,
      );
      saveState(pi, newState);

      if (newState.status === "completed") {
        ctx.ui.setStatus("gstack", undefined);
        const completedPhases = Object.entries(newState.results)
          .filter(([, r]) => r.status === "completed")
          .map(([id]) => id);
        return {
          content: [{
            type: "text" as const,
            text: `Workflow "${workflow.name}" completed! Phases done: ${completedPhases.join(", ")}.`,
          }],
        };
      }

      if (newState.status === "paused") {
        ctx.ui.setStatus("gstack", undefined);
        return {
          content: [{
            type: "text" as const,
            text: `Phase "${phase.name}" failed. Workflow paused. Use /gstack to resume, retry, or abort.`,
          }],
        };
      }

      const nextPhase = workflow.phases[newState.phaseIndex];
      executeCurrentPhase(pi, ctx, newState);

      return {
        content: [{
          type: "text" as const,
          text: `Phase "${phase.name}" recorded. Advancing to: ${nextPhase.name} (${newState.phaseIndex + 1}/${workflow.phases.length}).`,
        }],
      };
    },
  });
}
