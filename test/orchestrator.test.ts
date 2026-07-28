import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, advancePhase, abortState, resumeState, pauseState } from "../orchestrator/state.ts";
import { getAllWorkflows, getWorkflow, getWorkflowIds } from "../orchestrator/workflows.ts";

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
