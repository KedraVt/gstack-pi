import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createState, advancePhase, abortState, resumeState, pauseState, gateForApproval, approveNext } from "../orchestrator/state.ts";
import { getAllWorkflows, getWorkflow, getWorkflowIds } from "../orchestrator/workflows.ts";
import { loadSkillDigest, getSkillInfo, buildSkillIndex } from "../orchestrator/skills.ts";
import { buildPhaseInstructions, buildDeterministicPlan } from "../orchestrator/templates.ts";
import type { WorkflowContext } from "../orchestrator/types.ts";

function makeCtx(workflowId: string, phaseIndex = 0): WorkflowContext {
  return {
    state: { workflowId, phaseIndex, status: "active", goal: "test goal", results: {} },
    git: {
      branch: "feature/test",
      hasUncommittedChanges: true,
      hasStagedChanges: false,
      aheadOfRemote: 0,
      behindRemote: 0,
      isMainBranch: false,
      recentCommitSubject: "test",
    },
    cwd: process.cwd(),
  };
}

describe("state machine", () => {
  test("createState initializes correctly", () => {
    const state = createState("investigate", "fix login bug");
    assert.equal(state.workflowId, "investigate");
    assert.equal(state.phaseIndex, 0);
    assert.equal(state.status, "active");
    assert.equal(state.goal, "fix login bug");
    assert.deepEqual(state.results, {});
  });

  test("advancePhase moves to next phase", () => {
    const state = createState("investigate", "fix bug");
    const next = advancePhase(state, "reproduce", { status: "completed", summary: "Reproduced" }, 5);
    assert.equal(next.phaseIndex, 1);
    assert.equal(next.status, "active");
    assert.equal(next.results["reproduce"].summary, "Reproduced");
  });

  test("advancePhase completes at last phase", () => {
    const state = { ...createState("review", "check code"), phaseIndex: 2 };
    const next = advancePhase(state, "fix", { status: "completed", summary: "Fixed" }, 3);
    assert.equal(next.status, "completed");
  });

  test("advancePhase pauses on failure", () => {
    const state = createState("ship", "deploy");
    const next = advancePhase(state, "pre-checks", { status: "failed", summary: "Tests failing" }, 5);
    assert.equal(next.status, "paused");
    assert.equal(next.phaseIndex, 0);
  });

  test("abortState sets aborted", () => {
    const state = createState("qa", "test site");
    assert.equal(abortState(state).status, "aborted");
  });

  test("resumeState reactivates", () => {
    const state = pauseState(createState("qa", "test site"));
    assert.equal(state.status, "paused");
    assert.equal(resumeState(state).status, "active");
  });
});

describe("workflows registry", () => {
  test("all 6 workflows registered", () => {
    assert.equal(getAllWorkflows().length, 6);
  });

  test("getWorkflow returns correct workflow", () => {
    const wf = getWorkflow("investigate");
    assert.ok(wf);
    assert.equal(wf.name, "Bug Investigation");
    assert.equal(wf.phases.length, 5);
  });

  test("getWorkflow returns undefined for unknown", () => {
    assert.equal(getWorkflow("nonexistent"), undefined);
  });

  test("getWorkflowIds returns all ids", () => {
    const ids = getWorkflowIds();
    assert.ok(ids.includes("develop"));
    assert.ok(ids.includes("investigate"));
    assert.ok(ids.includes("qa"));
    assert.ok(ids.includes("ship"));
    assert.ok(ids.includes("review"));
    assert.ok(ids.includes("quick"));
  });

  test("all workflows have intents", () => {
    for (const wf of getAllWorkflows()) {
      assert.ok(wf.intents.length > 0, `${wf.id} has no intents`);
    }
  });

  test("all workflows have at least one phase", () => {
    for (const wf of getAllWorkflows()) {
      assert.ok(wf.phases.length > 0, `${wf.id} has no phases`);
    }
  });

  test("subagent phases have agent or chain", () => {
    for (const wf of getAllWorkflows()) {
      for (const phase of wf.phases) {
        if (phase.execution === "subagent") {
          assert.ok(
            phase.agent || (phase.chain && phase.chain.length > 0),
            `${wf.id}/${phase.id} is subagent but has no agent or chain`,
          );
        }
      }
    }
  });
});

describe("approval gates", () => {
  test("gateForApproval parks an active workflow in awaiting_approval", () => {
    const state = createState("develop", "add dark mode");
    const next = advancePhase(state, "understand", { status: "completed", summary: "Understood" }, 6);
    assert.equal(next.status, "active");
    const gated = gateForApproval(next);
    assert.equal(gated.status, "awaiting_approval");
    assert.equal(gated.phaseIndex, next.phaseIndex);
  });

  test("approveNext resumes an awaiting workflow", () => {
    const state = { ...createState("develop", "goal"), phaseIndex: 2, status: "awaiting_approval" as const };
    const approved = approveNext(state);
    assert.equal(approved.status, "active");
    assert.equal(approved.phaseIndex, 2);
  });

  test("approveNext is a no-op for non-awaiting states", () => {
    const state = createState("qa", "test site");
    assert.equal(approveNext(state).status, "active");
    assert.equal(gateForApproval({ ...state, status: "completed" }).status, "completed");
  });

  test("decision phases are marked manual", () => {
    const developPlan = getWorkflow("develop")!.phases.find((p) => p.id === "plan")!;
    assert.equal(developPlan.advance, "manual");
    const rootCause = getWorkflow("investigate")!.phases.find((p) => p.id === "root-cause")!;
    assert.equal(rootCause.advance, "manual");
    // Non-decision phases stay auto.
    for (const wf of getAllWorkflows()) {
      for (const phase of wf.phases) {
        if (!(wf.id === "develop" && phase.id === "plan") && !(wf.id === "investigate" && phase.id === "root-cause")) {
          assert.notEqual(phase.advance, "manual", `${wf.id}/${phase.id} should not be a manual gate`);
        }
      }
    }
  });
});

describe("skill ingestion", () => {
  test("all mapped skill digests exist and are small enough to inject", () => {
    for (const wf of getAllWorkflows()) {
      for (const phase of wf.phases) {
        if (!phase.skill) continue;
        const digest = loadSkillDigest(phase.skill);
        assert.ok(digest, `missing digest for ${phase.skill} (${wf.id}/${phase.id})`);
        assert.ok(digest.length < 16 * 1024, `digest ${phase.skill} too large: ${digest.length} chars`);
        assert.ok(digest.includes("# Skill:"), `digest ${phase.skill} missing header`);
      }
    }
  });

  test("loadSkillDigest returns null for unknown or broken skills", () => {
    assert.equal(loadSkillDigest("nonexistent-skill"), null);
  });

  test("getSkillInfo resolves full SKILL.md path that exists on disk", () => {
    const info = getSkillInfo("gstack-review")!;
    assert.ok(info);
    assert.ok(existsSync(info.fullPath), `${info.fullPath} not found`);
  });

  test("phase instructions embed the digest for mapped phases", () => {
    const wf = getWorkflow("review")!;
    const findings = wf.phases.find((p) => p.id === "findings")!;
    const instructions = buildPhaseInstructions(findings, makeCtx("review"));
    assert.ok(instructions.includes("### Skill methodology: gstack-review"), "digest block missing");
    assert.ok(instructions.includes("Scope drift"), "upstream methodology content missing");
  });

  test("phase instructions omit skill blocks when no skill is mapped", () => {
    const wf = getWorkflow("quick")!;
    const action = wf.phases.find((p) => p.id === "action")!;
    const instructions = buildPhaseInstructions(action, makeCtx("quick"));
    assert.ok(!instructions.includes("### Skill methodology"));
  });

  test("advancement rule forbids deferring progression to the user", () => {
    const wf = getWorkflow("ship")!;
    const preChecks = wf.phases[0];
    const instructions = buildPhaseInstructions(preChecks, makeCtx("ship"));
    assert.ok(instructions.includes("Never ask the user to run a command"));
  });

  test("manual-gate phases announce the approval pause in instructions", () => {
    const wf = getWorkflow("develop")!;
    const plan = wf.phases.find((p) => p.id === "plan")!;
    const instructions = buildPhaseInstructions(plan, makeCtx("develop"));
    assert.ok(instructions.includes("DECISION PHASE"), "manual gate not announced");
  });
});

describe("deterministic delegation plan", () => {
  test("single-agent phases resolve to one interpolated task with skill content", () => {
    const wf = getWorkflow("develop")!;
    const qa = wf.phases.find((p) => p.id === "qa")!;
    const plan = buildDeterministicPlan(qa, makeCtx("develop"));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].agent, "worker");
    assert.ok(plan[0].task.includes("test goal"), "goal not interpolated");
    assert.ok(plan[0].task.includes("Skill methodology: gstack-qa"), "skill digest not embedded in task");
  });

  test("chain phases resolve to sequential steps with agents preserved", () => {
    const wf = getWorkflow("investigate")!;
    const rootCause = wf.phases.find((p) => p.id === "root-cause")!;
    const plan = buildDeterministicPlan(rootCause, makeCtx("investigate"));
    assert.equal(plan.length, 2);
    assert.deepEqual(plan.map((s) => s.agent), ["scout", "planner"]);
    assert.ok(plan[0].task.includes("test goal"), "goal not interpolated in chain step");
  });
});

describe("intent matching", () => {
  test("investigate matches debug keywords", () => {
    const wf = getWorkflow("investigate")!;
    const text = "why is the login page broken";
    const matched = wf.intents.some((i) => i.pattern.test(text));
    assert.ok(matched);
  });

  test("ship matches deploy keywords", () => {
    const wf = getWorkflow("ship")!;
    const text = "let's ship this and create a pr";
    const matched = wf.intents.some((i) => i.pattern.test(text));
    assert.ok(matched);
  });

  test("develop matches feature keywords", () => {
    const wf = getWorkflow("develop")!;
    const text = "build a new dashboard component";
    const matched = wf.intents.some((i) => i.pattern.test(text));
    assert.ok(matched);
  });

  test("qa matches test keywords", () => {
    const wf = getWorkflow("qa")!;
    const text = "does this work? test the site please";
    const matched = wf.intents.some((i) => i.pattern.test(text));
    assert.ok(matched);
  });
});
