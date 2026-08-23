import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAllWorkflows, getWorkflow, getWorkflowIds } from "./workflows.ts";
import { loadActiveState, createState, saveState, abortState, resumeState, approveNext } from "./state.ts";
import { detectGitContext } from "./git.ts";
import { launchPhase } from "./executor.ts";
import type { GitContext } from "./types.ts";

export function getCompletions(prefix: string) {
  // AutocompleteItem shape: { value, label, description? }
  const verbs = ["next"].map((v) => ({
    value: v,
    label: v,
    description: "Approve the gated phase and continue",
  }));
  const wf = getAllWorkflows()
    .filter((w) => w.id.startsWith(prefix.toLowerCase()))
    .map((w) => ({ value: w.id, label: w.id, description: w.description }));
  return [...wf, ...verbs];
}

export async function handleGstackCommand(args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  const argId = args.trim().toLowerCase();

  const activeState = loadActiveState(ctx);

  // /gstack next — approve a gated (awaiting_approval) workflow and continue.
  if (argId === "next") {
    if (!activeState) {
      ctx.ui.notify("No active workflow to advance.", "warning");
      return;
    }
    if (activeState.status !== "awaiting_approval") {
      const wf = getWorkflow(activeState.workflowId);
      const phaseName = wf?.phases[activeState.phaseIndex]?.name ?? "unknown";
      ctx.ui.notify(`Workflow is not waiting for approval (currently: ${activeState.status}, phase "${phaseName}").`, "warning");
      return;
    }
    const approved = approveNext(activeState);
    saveState(pi, approved);
    ctx.ui.notify("Approved — continuing workflow.", "info");
    launchPhase(pi, ctx, approved);
    return;
  }

  const git = await detectGitContext(ctx.cwd, pi);

  if (activeState) {
    const workflow = getWorkflow(activeState.workflowId);
    const phaseName = workflow?.phases[activeState.phaseIndex]?.name ?? "unknown";
    const progress = `(${activeState.phaseIndex + 1}/${workflow?.phases.length ?? 0})`;

    if (activeState.status === "awaiting_approval") {
      const choice = await ctx.ui.select(
        "Workflow awaiting your approval",
        [
          `Approve & continue: ${activeState.workflowId} → next phase after "${activeState.results && Object.keys(activeState.results).pop()}" ${progress}`,
          "Abort workflow",
        ],
      );
      if (choice?.startsWith("Approve")) {
        const approved = approveNext(activeState);
        saveState(pi, approved);
        launchPhase(pi, ctx, approved);
      } else if (choice === "Abort workflow") {
        const confirmed = await ctx.ui.confirm("Abort workflow?", `Stop "${activeState.workflowId}"?`);
        if (confirmed) {
          saveState(pi, abortState(activeState));
          ctx.ui.setStatus("gstack", undefined);
          ctx.ui.notify("Workflow aborted.", "info");
        }
      }
      return;
    }

    const choice = await ctx.ui.select("Workflow in progress", [
      `Resume: ${activeState.workflowId} → ${phaseName} ${progress}`,
      "Abort workflow",
      "Start new workflow",
    ]);

    if (!choice) return;

    if (choice.startsWith("Resume")) {
      const resumed = resumeState(activeState);
      saveState(pi, resumed);
      launchPhase(pi, ctx, resumed);
      return;
    }

    if (choice === "Abort workflow") {
      const confirmed = await ctx.ui.confirm("Abort workflow?", `Stop "${activeState.workflowId}" at phase ${activeState.phaseIndex + 1}?`);
      if (confirmed) {
        saveState(pi, abortState(activeState));
        ctx.ui.setStatus("gstack", undefined);
        ctx.ui.notify("Workflow aborted.", "info");
      }
      return;
    }
  }

  if (argId) {
    const workflow = getWorkflow(argId);
    if (workflow) {
      await startWorkflow(workflow.id, ctx, pi, git);
      return;
    }
    ctx.ui.notify(`Unknown workflow: "${argId}". Available: ${getWorkflowIds().join(", ")}`, "warning");
    return;
  }

  const sorted = getAllWorkflows().sort((a, b) => menuScore(b, git) - menuScore(a, git));
  const options = sorted.map((w) => `${w.id} — ${w.description}`);

  const selected = await ctx.ui.select("gstack: What would you like to do?", options);
  if (!selected) return;

  const selectedId = selected.split(" — ")[0];
  await startWorkflow(selectedId, ctx, pi, git);
}

async function startWorkflow(workflowId: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, git: GitContext): Promise<void> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) return;

  const goal = await ctx.ui.input("Describe your goal", `e.g. "Add dark mode to the settings page"`);
  if (!goal) return;

  const state = createState(workflowId, goal);
  saveState(pi, state);

  ctx.ui.notify(`Starting: ${workflow.name} (${workflow.phases.length} phases)`, "info");
  launchPhase(pi, ctx, state);
}

function menuScore(w: { id: string }, git: GitContext): number {
  switch (w.id) {
    case "ship":
      return git.hasStagedChanges || git.aheadOfRemote > 0 ? 10 : 2;
    case "investigate":
      return git.hasUncommittedChanges ? 7 : 3;
    case "review":
      return git.aheadOfRemote > 0 ? 8 : 3;
    case "qa":
      return 5;
    case "qa-report":
      return 4;
    case "develop":
      return git.isMainBranch ? 6 : 4;
    case "quick":
      return 1;
    default:
      return 0;
  }
}
