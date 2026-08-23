import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createState, advancePhase, abortState, resumeState, pauseState, gateForApproval, approveNext } from "../orchestrator/state.ts";
import { getAllWorkflows, getWorkflow, getWorkflowIds } from "../orchestrator/workflows.ts";
import { loadSkillDigest, getSkillInfo, buildSkillIndex, getSkillIds } from "../orchestrator/skills.ts";
import { buildPhaseInstructions, buildDeterministicPlan, planFilePath } from "../orchestrator/templates.ts";
import type { WorkflowContext, WorkflowPhase } from "../orchestrator/types.ts";
import { launchPhase, ctxAlive } from "../orchestrator/executor.ts";
import { activityLabelFromEvent } from "../orchestrator/spawn.ts";
import {
  beginRun,
  ensureRun,
  recordDelegatedStep,
  buildRunReport,
  runReportFileName,
  writeRunReport,
  resetTelemetry,
} from "../orchestrator/telemetry.ts";

// --- Live subagent activity labels ----------------------------------------

test("activityLabelFromEvent: tool_execution_start yields tool + target", () => {
  const label = activityLabelFromEvent({
    type: "tool_execution_start",
    toolName: "read",
    args: { path: "src/app.ts" },
  });
  assert.ok(label!.includes("read"));
  assert.ok(label!.includes("src/app.ts"));
});

test("activityLabelFromEvent: assistant message_start yields thinking", () => {
  const label = activityLabelFromEvent({ type: "message_start", message: { role: "assistant" } });
  assert.equal(label, "thinking…");
});

test("activityLabelFromEvent: assistant message_end yields text preview", () => {
  const label = activityLabelFromEvent({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "The root cause is\nthe retry loop." }] },
  });
  assert.ok(label!.startsWith("writing:"));
});

test("activityLabelFromEvent: unknown or malformed events yield null safely", () => {
  assert.equal(activityLabelFromEvent({ type: "turn_start" }), null);
  assert.equal(activityLabelFromEvent(null), null);
  assert.equal(activityLabelFromEvent(undefined), null);
  assert.equal(activityLabelFromEvent("garbage"), null);
});

// --- Runtime liveness guards (session reload crash fix) -------------------

test("ctxAlive returns true for a healthy context", () => {
  const ctx = { ui: { notify() {} } };
  assert.equal(ctxAlive(ctx), true);
});

test("ctxAlive returns false when the context is stale (ui getter throws)", () => {
  const stale = {
    get ui() {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    },
  };
  assert.equal(ctxAlive(stale), false);
});

test("launchPhase swallows stale-context rejections without throwing", async () => {
  const pi = {} as any;
  const ctx = { ui: { notify() { throw new Error("stale"); } } } as any;
  let called = false;
  // Must not throw synchronously nor produce an unhandled rejection.
  launchPhase(pi, ctx, {} as any, async () => {
    called = true;
    throw new Error("Extension ctx is stale after session replacement or reload.");
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(called, true);
});

test("launchPhase reports non-stale errors best-effort", async () => {
  const seen: Array<{ msg: string; level: string }> = [];
  const pi = {} as any;
  const ctx = { ui: { notify(msg: string, level: string) { seen.push({ msg, level }); } } } as any;
  launchPhase(pi, ctx, {} as any, async () => {
    throw new Error("boom during phase");
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen.length, 1);
  assert.ok(seen[0].msg.includes("boom during phase"));
});

function makeCtx(workflowId: string, phaseIndex = 0, skillsDelivered: string[] = []): WorkflowContext {
  return {
    state: { workflowId, phaseIndex, status: "active", goal: "add dark mode toggle", results: {}, skillsDelivered },
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

function findPhase(workflowId: string, phaseId: string): WorkflowPhase {
  const phase = getWorkflow(workflowId)!.phases.find((p) => p.id === phaseId);
  assert.ok(phase, `${workflowId}/${phaseId} not found`);
  return phase;
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
  test("all 7 workflows registered", () => {
    assert.equal(getAllWorkflows().length, 7);
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
    for (const id of ["develop", "investigate", "qa", "qa-report", "ship", "review", "quick"]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
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
  test("all registered skill digests exist and are small enough to inject", () => {
    for (const id of getSkillIds()) {
      const digest = loadSkillDigest(id);
      assert.ok(digest, `missing digest for ${id}`);
      assert.ok(digest.length < 16 * 1024, `digest ${id} too large: ${digest.length} chars`);
      assert.ok(digest.includes("# Skill:"), `digest ${id} missing header`);
    }
    for (const wf of getAllWorkflows()) {
      for (const phase of wf.phases) {
        for (const id of phase.skills ?? []) {
          const info = getSkillInfo(id);
          assert.ok(info, `phase ${wf.id}/${phase.id} references unknown skill ${id}`);
        }
      }
    }
  });

  test("loadSkillDigest returns null for unknown skills; grilling is vendored", () => {
    assert.equal(loadSkillDigest("nonexistent-skill"), null);
    const grilling = getSkillInfo("grilling")!;
    assert.equal(grilling.fullPath, null);
    assert.ok(existsSync(grilling.distilledPath));
  });

  test("getSkillInfo resolves full SKILL.md paths that exist on disk", () => {
    for (const id of ["gstack-review", "gstack-office-hours", "gstack-document-generate"]) {
      const info = getSkillInfo(id)!;
      assert.ok(info.fullPath, `${id} should have an upstream SKILL.md`);
      assert.ok(existsSync(info.fullPath), `${info.fullPath} not found`);
    }
  });

  test("every registered skill exposes a DoD + best-practices gate", () => {
    for (const id of getSkillIds()) {
      const info = getSkillInfo(id)!;
      assert.ok(info.dod.includes("DoD:"), `${id} gate missing DoD`);
      assert.ok(/BP:/.test(info.dod), `${id} gate missing best practices`);
    }
  });
});

describe("skill tiering in orchestrator instructions", () => {
  test("MAIN phases embed full digests", () => {
    const plan = findPhase("develop", "plan");
    assert.equal(plan.execution, "main");
    const instructions = buildPhaseInstructions(plan, makeCtx("develop", 2));
    assert.ok(instructions.includes("# Skill: grilling"), "grilling protocol missing");
    assert.ok(instructions.includes("frontier"), "interview protocol content missing");
    assert.ok(instructions.includes("# Skill: gstack-plan-eng-review"), "eng rigor missing");
  });

  test("SUBAGENT phases carry DoD gates only â€” full digests stay out of orchestrator context", () => {
    const review = findPhase("ship", "review");
    assert.equal(review.execution, "subagent");
    const instructions = buildPhaseInstructions(review, makeCtx("ship"));
    assert.ok(instructions.includes("Skill gate: gstack-review"));
    assert.ok(instructions.includes("DoD: Scope Check line"));
    assert.ok(!instructions.includes("# Skill: gstack-review"), "full digest leaked into orchestrator instructions");
  });

  test("repeat delivery degrades to the DoD gate even on main phases", () => {
    const ctx = makeCtx("investigate", 3, ["gstack-investigate"]);
    const verify = findPhase("investigate", "verify");
    const instructions = buildPhaseInstructions(verify, ctx);
    assert.ok(instructions.includes("Skill gate: gstack-investigate"));
    assert.ok(!instructions.includes("# Skill: gstack-investigate"), "full digest re-delivered");
  });

  test("phases without skills get no skill blocks; advancement rule intact", () => {
    const action = findPhase("quick", "action");
    const instructions = buildPhaseInstructions(action, makeCtx("quick"));
    assert.ok(!instructions.includes("Skill gate"));
    assert.ok(instructions.includes("Never ask the user to run a command"));
  });

  test("manual-gate phases announce the approval pause", () => {
    const plan = findPhase("develop", "plan");
    const instructions = buildPhaseInstructions(plan, makeCtx("develop", 2));
    assert.ok(instructions.includes("DECISION PHASE"));
  });
});

describe("plan cycle (interactive, hybrid)", () => {
  test("develop has a dedicated scout explore phase right before planning", () => {
    const wf = getWorkflow("develop")!;
    const ids = wf.phases.map((p) => p.id);
    const exploreIdx = ids.indexOf("explore");
    assert.ok(exploreIdx >= 0 && ids[exploreIdx + 1] === "plan", `order wrong: ${ids.join(",")}`);
    assert.equal(findPhase("develop", "explore").agent, "scout");
  });

  test("plan phase: rounds, recommended answers, question cap, plan-file write, no implement", () => {
    const plan = findPhase("develop", "plan");
    const instructions = buildPhaseInstructions(plan, makeCtx("develop", 2));
    assert.ok(instructions.includes("recommended answer"));
    assert.ok(instructions.includes("Maximum 5 questions"));
    assert.ok(instructions.includes(".gstack/plans/"));
    assert.ok(instructions.includes("Do NOT start implementing"));
  });

// --- Phase scope boundaries (session-debug 2026-08-22: reproduce drifted into root-causing) ---

test("reproduce phase tasks carry a reproduction-only scope boundary", () => {
  const wf = getWorkflow("investigate")!;
  const reproduce = wf.phases.find((p) => p.id === "reproduce")!;
  // reproduce is a MAIN phase â€” its boundary must appear in buildPhaseInstructions
  const instructions = buildPhaseInstructions(reproduce, makeCtx("investigate", 0));
  assert.ok(instructions.includes("SCOPE BOUNDARY"), "reproduction boundary missing from main-phase instructions");
  assert.ok(instructions.includes("do NOT"));
});

test("root-cause phase tasks carry the validate-first directive", () => {
  const wf = getWorkflow("investigate")!;
  const rootCause = wf.phases.find((p) => p.id === "root-cause")!;
  const plan = buildDeterministicPlan(rootCause, makeCtx("investigate", 1));
  assert.ok(plan.length > 0);
  assert.ok(plan.some((s) => s.task.includes("VALIDATE it quickly")));
});

  test("implement worker reads the plan file, not a lossy summary", () => {
    const implement = findPhase("develop", "implement");
    const plan = buildDeterministicPlan(implement, makeCtx("develop", 3));
    assert.equal(plan[0].agent, "worker");
    assert.ok(plan[0].task.includes(".gstack/plans/add-dark-mode-toggle.md"), "plan file reference missing");
    assert.ok(plan[0].task.includes("Read it FIRST"), "plan-first instruction missing");
  });

  test("no delegated task imposes an arbitrary tool-call budget", () => {
    for (const wfid of getWorkflowIds()) {
      const wf = getWorkflow(wfid)!;
      for (const phase of wf.phases) {
        if (phase.execution !== "subagent") continue;
        const plan = buildDeterministicPlan(phase, makeCtx(wfid, 0));
        for (const step of plan) assert.ok(!step.task.includes("tool calls"), `${wfid}/${phase.id}`);
      }
    }
  });
});

describe("documentation phases", () => {
  test("develop ends with an optional document phase carrying both doc skills", () => {
    const doc = findPhase("develop", "document");
    assert.equal(doc.optional, true);
    assert.deepEqual(doc.skills, ["gstack-document-release", "gstack-document-generate"]);
  });

  test("ship carries an update-docs phase with both doc skills", () => {
    const doc = findPhase("ship", "update-docs");
    assert.equal(doc.optional, true);
    assert.deepEqual(doc.skills, ["gstack-document-release", "gstack-document-generate"]);
  });

  test("document task chains generate pass and requires DOC REPORT + atomic docs commit", () => {
    const doc = findPhase("develop", "document");
    const plan = buildDeterministicPlan(doc, makeCtx("develop", 7));
    assert.ok(plan[0].task.includes("Diataxis coverage map"));
    assert.ok(plan[0].task.includes("DOC REPORT"));
    assert.ok(plan[0].task.includes("docs: prefix"));
  });

  test("ship digest mandates TODOS.md management and git best practices", () => {
    const digest = loadSkillDigest("gstack-ship")!;
    assert.ok(digest.includes("TODOS.md management (mandatory)"));
    assert.ok(digest.includes("Git best practices throughout"));
  });
});

describe("qa report-only mode", () => {
  test("qa-report workflow exists, all phases report-only", () => {
    const wf = getWorkflow("qa-report")!;
    assert.equal(wf.name, "QA Report (No Fixes)");
    for (const phase of wf.phases) {
      assert.equal(phase.variant, "report-only", `${wf.id}/${phase.id} not report-only`);
    }
  });

  test("report-only directives appear in instructions and subagent tasks", () => {
    const setup = findPhase("qa-report", "setup");
    assert.ok(buildPhaseInstructions(setup, makeCtx("qa-report")).includes("REPORT-ONLY MODE"));

    const testPhase = findPhase("qa-report", "test");
    const plan = buildDeterministicPlan(testPhase, makeCtx("qa-report", 1));
    assert.ok(plan[0].task.includes("REPORT-ONLY MODE"));
    assert.ok(plan[0].task.includes("do NOT fix anything"));
  });

  test("normal qa workflow is NOT report-only", () => {
    for (const phase of getWorkflow("qa")!.phases) {
      assert.notEqual(phase.variant, "report-only");
    }
  });
});

describe("deterministic delegation plan", () => {
  test("single-agent phases resolve to one interpolated task with skill content", () => {
    const qa = findPhase("develop", "qa");
    const plan = buildDeterministicPlan(qa, makeCtx("develop", 4));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].agent, "worker");
    assert.ok(plan[0].task.includes("add dark mode toggle"), "goal not interpolated");
    assert.ok(plan[0].task.includes("Skill methodology: gstack-qa"), "skill digest not embedded in task");
  });

  test("chain steps also receive embedded skill methodology", () => {
    const rootCause = findPhase("investigate", "root-cause");
    assert.equal(rootCause.advance, "manual");
    const plan = buildDeterministicPlan(rootCause, makeCtx("investigate", 1));
    assert.deepEqual(plan.map((s) => s.agent), ["scout", "planner"]);
    assert.ok(plan[0].task.includes("Skill methodology: gstack-investigate"), "digest not embedded in chain step");
    assert.ok(plan[0].task.includes("add dark mode toggle"), "goal not interpolated in chain step");
  });

  test("explore phase delegates to the scout agent deterministically", () => {
    const explore = findPhase("develop", "explore");
    const plan = buildDeterministicPlan(explore, makeCtx("develop", 1));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].agent, "scout");
    assert.ok(plan[0].task.includes("Facts only"), "exploration discipline missing");
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

// --- STEP 0: structured run-report telemetry --------------------------------

describe("run-report telemetry", () => {
  test("report schema is stable", () => {
    resetTelemetry();
    beginRun("investigate");
    recordDelegatedStep({
      phaseId: "root-cause",
      stepIndex: 0,
      agent: "scout",
      durationMs: 65432,
      toolCalls: 27,
      turns: 9,
      tokensIn: 120000,
      tokensCacheRead: 90000,
      tokensOut: 5400,
      timeoutClass: "default",
    });
    const report = buildRunReport("investigate");
    assert.equal(report.workflowId, "investigate");
    assert.equal(report.steps.length, 1);
    const step = report.steps[0];
    for (const key of [
      "phaseId", "stepIndex", "agent", "durationMs", "toolCalls", "turns",
      "tokensIn", "tokensCacheRead", "tokensOut", "handoffLevel", "incomplete",
      "timedOut", "timeoutClass",
    ]) {
      assert.ok(key in step, `missing field in report step: ${key}`);
    }
    assert.ok(report.startedAt.length > 0);
    assert.ok(report.writtenAt.length > 0);
    assert.ok(Array.isArray(report.livenessObservations));
  });

  test("writeRunReport persists a JSON report under .gstack/runs after a simulated run", () => {
    resetTelemetry();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gstack-telemetry-"));
    try {
      beginRun("investigate");
      recordDelegatedStep({ phaseId: "reproduce", stepIndex: 0, agent: "worker", durationMs: 1000, timeoutClass: "default" });
      const filePath = writeRunReport(tmp, "investigate");
      assert.ok(filePath, "expected a written report");
      assert.ok(existsSync(filePath));
      assert.ok(filePath.includes(path.join(".gstack", "runs")));
      assert.ok(/\.json$/.test(filePath));
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      assert.equal(parsed.workflowId, "investigate");
      assert.equal(parsed.steps.length, 1);
      assert.equal(parsed.steps[0].phaseId, "reproduce");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      resetTelemetry();
    }
  });

  test("writing is best-effort: consumed accumulator and foreign workflow yield null, never a throw", () => {
    resetTelemetry();
    beginRun("qa");
    assert.equal(writeRunReport(process.cwd(), "develop"), null); // different workflow
    assert.ok(writeRunReport(process.cwd(), "qa"), "active run should write");
    assert.equal(writeRunReport(process.cwd(), "qa"), null, "accumulator consumed after flush");
    resetTelemetry();
  });

  test("ensureRun starts a run once and does not clobber an active one", () => {
    resetTelemetry();
    ensureRun("ship");
    recordDelegatedStep({ phaseId: "review", stepIndex: 0, agent: "reviewer", durationMs: 10 });
    ensureRun("ship"); // must NOT reset the accumulator
    recordDelegatedStep({ phaseId: "test", stepIndex: 0, agent: "worker", durationMs: 20 });
    assert.equal(buildRunReport("ship").steps.length, 2);
    resetTelemetry();
  });

  test("file names are Windows-safe (no colons)", () => {
    const name = runReportFileName("2026-08-23T10:30:00.000Z", "investigate");
    assert.ok(!name.includes(":"));
    assert.ok(name.endsWith("-investigate.json"));
  });
});

// --- STEP 1: deliverable-first contracts + language audit --------------------

describe("deliverable-first contracts (STEP 1)", () => {
  const ITALIAN_STOPLIST = ["fase", "trova", "leggi", "scrivi", "deve", "sempre", "perchÃ©", "delle", "degli", "questo"];

  function injectableStrings(): string[] {
    const out: string[] = [];
    for (const wf of getAllWorkflows()) {
      let idx = 0;
      for (const phase of wf.phases) {
        const ctx = makeCtx(wf.id, idx++);
        if (phase.execution === "subagent") {
          for (const step of buildDeterministicPlan(phase, ctx)) out.push(step.task);
        } else {
          out.push(buildPhaseInstructions(phase, ctx));
        }
      }
    }
    for (const id of getSkillIds()) {
      const digest = loadSkillDigest(id);
      if (digest) out.push(digest);
    }
    return out;
  }

  test("every phase on every path carries DELIVERABLE and STOP CONDITION", () => {
    for (const wf of getAllWorkflows()) {
      let idx = 0;
      for (const phase of wf.phases) {
        const ctx = makeCtx(wf.id, idx++);
        if (phase.execution === "subagent") {
          const plan = buildDeterministicPlan(phase, ctx);
          assert.ok(plan.length > 0, `${wf.id}/${phase.id} produced an empty plan`);
          for (const step of plan) {
            assert.ok(step.task.includes("## DELIVERABLE"), `${wf.id}/${phase.id} (${step.agent}) task missing DELIVERABLE`);
            assert.ok(step.task.includes("## STOP CONDITION"), `${wf.id}/${phase.id} (${step.agent}) task missing STOP CONDITION`);
          }
        } else {
          const instructions = buildPhaseInstructions(phase, ctx);
          assert.ok(instructions.includes("## DELIVERABLE"), `${wf.id}/${phase.id} main instructions missing DELIVERABLE`);
          assert.ok(instructions.includes("## STOP CONDITION"), `${wf.id}/${phase.id} main instructions missing STOP CONDITION`);
        }
      }
    }
  });

  test("methodology blocks carry the correct class prefix and follow the deliverable", () => {
    const qa = findPhase("develop", "qa");
    const qaPlan = buildDeterministicPlan(qa, makeCtx("develop", 4));
    assert.ok(qaPlan[0].task.includes("Skill methodology: gstack-qa (format-critical)"), "qa should be format-critical");
    assert.ok(
      qaPlan[0].task.includes("output format IS part of the deliverable"),
      "format-critical prefix missing",
    );
    assert.ok(
      qaPlan[0].task.indexOf("## DELIVERABLE") < qaPlan[0].task.indexOf("## METHODOLOGY"),
      "methodology must come after the deliverable",
    );

    const pushPr = findPhase("ship", "push-pr");
    const shipPlan = buildDeterministicPlan(pushPr, makeCtx("ship", 4));
    assert.ok(shipPlan[0].task.includes("Skill methodology: gstack-ship (support)"), "ship should be support-class");
    assert.ok(shipPlan[0].task.includes("Apply the parts useful to the deliverable"), "support prefix missing");
  });

  test("update-docs resolves to the real doc contract instead of the generic fallback", () => {
    const updateDocs = findPhase("ship", "update-docs");
    const plan = buildDeterministicPlan(updateDocs, makeCtx("ship", 4));
    assert.equal(plan.length, 1);
    assert.ok(plan[0].task.includes("Diataxis coverage map"), "generic fallback leaked through for update-docs");
    assert.ok(plan[0].task.includes("DOC REPORT"));
    assert.ok(plan[0].task.includes("docs: prefix"));
  });

  test("language audit: zero non-English content in injectable strings", () => {
    for (const s of injectableStrings()) {
      const lower = s.toLowerCase();
      for (const word of ITALIAN_STOPLIST) {
        assert.ok(
          !new RegExp(`\\b${word}\\b`).test(lower),
          `Italian stoplist word "${word}" found in: ${s.slice(0, 140).replace(/\s+/g, " ")}...`,
        );
      }
      assert.ok(
        !/[Ã Ã¨Ã©Ã¬Ã²Ã¹]/i.test(s),
        `accented letter found in: ${s.slice(0, 140).replace(/\s+/g, " ")}...`,
      );
    }
  });
});

// --- STEP 2: HANDOFF protocol, safe interpolation, resilience ----------------

import { extractHandoff } from "../orchestrator/handoff.ts";
import { replaceExact } from "../orchestrator/text.ts";
import { isTransientFailure, retryDecision, RETRY_DELAY_MS } from "../orchestrator/executor.ts";
import { optionalPhases } from "../orchestrator/config.ts";

function bigReport(handoffSection?: string): string {
  const filler = "x".repeat(9000);
  return `## REPORT\n${filler}\n${handoffSection ?? ""}`;
}
const GOOD_HANDOFF = "## HANDOFF\nVERIFIED FACTS:\n- retry loop resets state @ src/app.ts:42\nDECISIONS: none\nOPEN QUESTIONS: none\nDO NOT REDO: reproduction";

describe("extractHandoff levels (STEP 2b)", () => {
  test("small output travels whole at level raw", () => {
    const h = extractHandoff("short report");
    assert.equal(h.level, "raw");
    assert.equal(h.text, "short report");
  });

  test("empty output yields the failed-step placeholder", () => {
    const h = extractHandoff("");
    assert.equal(h.level, "raw");
    assert.equal(h.text, "(previous step failed)");
    assert.equal(extractHandoff("   ").text, "(previous step failed)");
  });

  test("valid HANDOFF section inside a long report is extracted as full", () => {
    const h = extractHandoff(bigReport(GOOD_HANDOFF));
    assert.equal(h.level, "full");
    assert.ok(h.text.startsWith("## HANDOFF"));
    assert.ok(h.text.includes("VERIFIED FACTS"));
    assert.ok(h.text.length <= 4000, "full handoff must stay within the 4000-char invariant");
  });

  test("malformed HANDOFF section degrades to partial", () => {
    const h = extractHandoff(bigReport("## HANDOFF\nsome unstructured tail note"));
    assert.equal(h.level, "partial");
    assert.ok(h.text.includes("unstructured tail note"));
  });

  test("oversized or absent HANDOFF falls back to the paragraph-cut tail", () => {
    const oversized = `## HANDOFF\nVERIFIED FACTS:\n${"y".repeat(5000)}`;
    const h1 = extractHandoff(bigReport(oversized));
    assert.equal(h1.level, "fallback");
    assert.ok(h1.text.length <= 12000);
    const h2 = extractHandoff("z".repeat(20000));
    assert.equal(h2.level, "fallback");
    assert.ok(h2.text.length <= 12000);
  });

  test("incomplete output caps the level at fallback", () => {
    assert.equal(extractHandoff(bigReport(GOOD_HANDOFF), { incomplete: true }).level, "fallback");
    assert.equal(extractHandoff("tiny", { incomplete: true }).level, "fallback");
  });
});

describe("$-safe interpolation (STEP 2c)", () => {
  test("replaceExact treats $ patterns literally", () => {
    const evil = `$& $\` $' $1 $$`;
    assert.equal(replaceExact("A B", /B/, evil), `A ${evil}`);
    // Sanity: naive .replace would have corrupted the output.
    assert.notEqual("A B".replace(/B/, evil), `A ${evil}`);
  });

  function ctxWithGoal(goal: string): WorkflowContext {
    const c = makeCtx("develop", 0);
    c.state.goal = goal;
    return c;
  }

  test("interpolate() survives $&, $', $1 payloads in the user goal", () => {
    const evilGoal = "add $& dark $' mode $1 toggle $$";
    const explore = findPhase("develop", "explore");
    const plan = buildDeterministicPlan(explore, ctxWithGoal(evilGoal));
    assert.ok(plan[0].task.includes(evilGoal), "goal corrupted by $ pattern interpolation");
  });
});

describe("AGENTS_NOTES mirror (STEP 2e)", () => {
  const PLANNER_DIRECTIVE = "You receive VERIFIED FACTS from a prior specialist. Treat them as context, not proof: do NOT re-verify systematically, but ALWAYS re-check claims that are load-bearing for code changes you are about to make.";
  const WORKER_DIRECTIVE = "Trust the HANDOFF section of the task as working context; re-check only claims that are load-bearing for edits you are about to make.";
  const HOME_AGENTS_DIR = path.join(os.homedir(), ".pi", "agent", "agents");

  test("home agent files carry the directives documented in AGENTS_NOTES.md", () => {
    const planner = readFileSync(path.join(HOME_AGENTS_DIR, "planner.md"), "utf-8");
    const worker = readFileSync(path.join(HOME_AGENTS_DIR, "worker.md"), "utf-8");
    assert.ok(planner.includes(PLANNER_DIRECTIVE), "planner.md drifted from AGENTS_NOTES.md");
    assert.ok(worker.includes(WORKER_DIRECTIVE), "worker.md drifted from AGENTS_NOTES.md");
  });

  test("AGENTS_NOTES.md documents both directives", () => {
    const notes = readFileSync(path.join(process.cwd(), "AGENTS_NOTES.md"), "utf-8");
    assert.ok(notes.includes("planner.md"));
    assert.ok(notes.includes("worker.md"));
  });
});

describe("chain retry policy (STEP 2f)", () => {
  const okResult: any = { ok: true, output: "done", exitCode: 0, durationMs: 10 };
  const timeoutResult: any = { ok: false, output: "partial", exitCode: null, durationMs: 100, timedOut: true, incomplete: true };
  const exitFailNoOutput: any = { ok: false, output: "", error: "crashed", exitCode: 3, durationMs: 50 };
  const configError: any = { ok: false, output: "", error: 'Unknown agent "nope".', exitCode: 1, durationMs: 0, configError: true };

  test("transient failures are retried once with a +50% timeout; hard failures are not", () => {
    assert.deepEqual(retryDecision(timeoutResult, 1), { retry: true, timeoutScale: 1.5 });
    assert.deepEqual(retryDecision(exitFailNoOutput, 1), { retry: true, timeoutScale: 1.5 });
    assert.deepEqual(retryDecision(okResult, 1), { retry: false, timeoutScale: 1 });
    assert.deepEqual(retryDecision(configError, 1), { retry: false, timeoutScale: 1 });
    assert.deepEqual(retryDecision(timeoutResult, 2), { retry: false, timeoutScale: 1 }, "at most one retry");
    assert.equal(RETRY_DELAY_MS, 30_000);
    assert.equal(isTransientFailure(configError), false);
    assert.equal(isTransientFailure(timeoutResult), true);
  });
});

describe("optional-phase modes (STEP 2g)", () => {
  test("GSTACK_PI_OPTIONAL_PHASES resolves ask/auto/skip with ask default", () => {
    const original = process.env.GSTACK_PI_OPTIONAL_PHASES;
    try {
      delete process.env.GSTACK_PI_OPTIONAL_PHASES;
      assert.equal(optionalPhases(), "ask");
      process.env.GSTACK_PI_OPTIONAL_PHASES = "auto";
      assert.equal(optionalPhases(), "auto");
      process.env.GSTACK_PI_OPTIONAL_PHASES = "skip";
      assert.equal(optionalPhases(), "skip");
      process.env.GSTACK_PI_OPTIONAL_PHASES = "garbage";
      assert.equal(optionalPhases(), "ask");
    } finally {
      if (original === undefined) delete process.env.GSTACK_PI_OPTIONAL_PHASES;
      else process.env.GSTACK_PI_OPTIONAL_PHASES = original;
    }
  });
});

// --- STEP 3: role-scoped skill injection -------------------------------------

describe("role-scoped skill injection (STEP 3)", () => {
  test("root-cause chain: scout gets the investigation digest, planner gets fix-strategy only", () => {
    const rootCause = findPhase("investigate", "root-cause");
    const plan = buildDeterministicPlan(rootCause, makeCtx("investigate", 1));
    assert.deepEqual(plan.map((s) => s.agent), ["scout", "planner"]);
    assert.ok(plan[0].task.includes("Skill methodology: gstack-investigate"), "scout lost the full methodology");
    assert.ok(plan[1].task.includes("Skill methodology: gstack-fix-strategy"), "planner missing the fix-strategy digest");
    assert.ok(!plan[1].task.includes("gstack-investigate"), "planner must NOT receive the full investigation digest [E1]");
  });

  test("gstack-fix-strategy is a vendored registry skill with a small digest", () => {
    const info = getSkillInfo("gstack-fix-strategy");
    assert.ok(info);
    assert.equal(info.fullPath, null, "must be vendored (no upstream SKILL.md)");
    const digest = loadSkillDigest("gstack-fix-strategy");
    assert.ok(digest);
    assert.ok(digest.length < 800, `digest too large: ${digest.length} chars`);
    assert.ok(digest.includes("# Skill:"));
    assert.ok(info.dod.includes("DoD:") && /BP:/.test(info.dod));
  });

  test("chain steps without an override inherit the phase skills", () => {
    // The document phase has no per-step override: its steps keep gstack-document-*.
    const doc = findPhase("develop", "document");
    const plan = buildDeterministicPlan(doc, makeCtx("develop", 7));
    for (const step of plan) {
      assert.ok(
        step.task.includes("Skill methodology: gstack-document-release") || step.task.includes("Skill methodology: gstack-document-generate"),
        "inherited phase skills lost",
      );
    }
  });
});

// --- STEP 4: structural skip with anti-spoofing guards -----------------------

import {
  parseRootCauseMarker,
  validateStrategyTask,
  allTestsPassed,
  isValidatedStrategy,
  isRefutedStrategy,
} from "../orchestrator/skip.ts";
import { autoGateValidated } from "../orchestrator/config.ts";

const VALID_MARKER = 'CONFIRMED ROOT CAUSE: retry loop resets cache state | files: src/app.ts, src/cache.ts';
const HANDOFF_PAYLOAD = "## HANDOFF\nVERIFIED FACTS:\n- cause confirmed @ src/app.ts:42\n" + VALID_MARKER;

describe("root-cause marker parsing (STEP 4b)", () => {
  test("parses a valid marker inside a HANDOFF with existing files", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gstack-skip-"));
    try {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      writeFileSync(path.join(tmp, "src", "app.ts"), "x");
      writeFileSync(path.join(tmp, "src", "cache.ts"), "x");
      const marker = parseRootCauseMarker(HANDOFF_PAYLOAD, tmp);
      assert.ok(marker);
      assert.equal(marker.cause, "retry loop resets cache state");
      assert.deepEqual(marker.files, ["src/app.ts", "src/cache.ts"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("marker outside HANDOFF yields null + warning", () => {
    const warnings: string[] = [];
    const text = "symptoms described here\n" + VALID_MARKER + "\n(no handoff section)" + "\n(no handoff section)";
    assert.equal(parseRootCauseMarker(text, process.cwd(), (m) => warnings.push(m)), null);
    assert.ok(warnings.some((w) => w.includes("[skip] root-cause marker outside HANDOFF ignored")));
  });

  test("nonexistent cited files yield null", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gstack-skip2-"));
    try {
      assert.equal(parseRootCauseMarker(HANDOFF_PAYLOAD, tmp), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("none / absent / malformed markers yield null", () => {
    assert.equal(parseRootCauseMarker("## HANDOFF\nCONFIRMED ROOT CAUSE: none | files: none", process.cwd()), null);
    assert.equal(parseRootCauseMarker("## HANDOFF\nno marker here", process.cwd()), null);
    assert.equal(parseRootCauseMarker("## HANDOFF\nCONFIRMED ROOT CAUSE: broken marker without files", process.cwd()), null);
  });

  test("validateStrategyTask keeps the anti-spoofing contract", () => {
    const task = validateStrategyTask({ cause: "cache reset loop", files: ["a.ts"] });
    assert.ok(task.includes("## DELIVERABLE"));
    assert.ok(task.includes("## STOP CONDITION"));
    assert.ok(task.includes('"cache reset loop"'));
    assert.ok(task.includes("REFUTED:"));
  });
});

describe("conditional collapse (STEP 4c)", () => {
  test("valid reproduce summary collapses the chain to ONE planner step", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gstack-collapse-"));
    try {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      writeFileSync(path.join(tmp, "src", "app.ts"), "x");
      writeFileSync(path.join(tmp, "src", "cache.ts"), "x");
      const ctx = makeCtx("investigate", 1);
      ctx.cwd = tmp;
      ctx.state.results["reproduce"] = { status: "completed", summary: "Reproduced reliably. " + HANDOFF_PAYLOAD };
      const rootCause = findPhase("investigate", "root-cause");
      const plan = buildDeterministicPlan(rootCause, ctx);
      assert.equal(plan.length, 1);
      assert.equal(plan[0].agent, "planner");
      assert.ok(plan[0].task.includes("CONFIRMED this cause"));
      assert.ok(!plan[0].task.toLowerCase().includes("scout"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("without a valid marker the full scout-planner plan stays intact", () => {
    const rootCause = findPhase("investigate", "root-cause");
    const plan = buildDeterministicPlan(rootCause, makeCtx("investigate", 1));
    assert.deepEqual(plan.map((s) => s.agent), ["scout", "planner"]);
  });
});

describe("refutation + QA skip helpers (STEP 4d)", () => {
  test("isValidated / isRefuted read the first meaningful line only", () => {
    assert.equal(isValidatedStrategy("VALIDATED: off-by-one @ a.ts:12\nmore"), true);
    assert.equal(isValidatedStrategy("the answer is VALIDATED:"), false);
    assert.equal(isRefutedStrategy("REFUTED: files were already correct"), true);
    assert.equal(isRefutedStrategy(""), false);
  });

  test("allTestsPassed is falsifiable and safe on malformed summaries", () => {
    assert.equal(allTestsPassed("Ran the suite: 120 passed, 0 failures"), true);
    assert.equal(allTestsPassed("All tests green after the fix"), true);
    assert.equal(allTestsPassed("2 failures in checkout flow"), false);
    assert.equal(allTestsPassed(undefined), false);
    assert.equal(allTestsPassed("garbage summary"), false);
  });

  test("qa fix phase gains a test-based structural skipWhen", () => {
    const qaFix = findPhase("qa", "fix");
    assert.ok(qaFix.skipWhen, "qa/fix must declare skipWhen");
    const passedCtx = makeCtx("qa", 3);
    passedCtx.state.results["test"] = { status: "completed", summary: "suite run: 50 passed, 0 failures" };
    assert.equal(qaFix.skipWhen!(passedCtx), true);
    const failedCtx = makeCtx("qa", 3);
    failedCtx.state.results["test"] = { status: "completed", summary: "3 failures found" };
    assert.equal(qaFix.skipWhen!(failedCtx), false);
  });
});

describe("auto-gate opt-in (STEP 4e)", () => {
  test("GSTACK_PI_AUTO_GATE_VALIDATED defaults OFF and parses correctly", () => {
    const original = process.env.GSTACK_PI_AUTO_GATE_VALIDATED;
    try {
      delete process.env.GSTACK_PI_AUTO_GATE_VALIDATED;
      assert.equal(autoGateValidated(), false);
      process.env.GSTACK_PI_AUTO_GATE_VALIDATED = "1";
      assert.equal(autoGateValidated(), true);
      process.env.GSTACK_PI_AUTO_GATE_VALIDATED = "off";
      assert.equal(autoGateValidated(), false);
    } finally {
      if (original === undefined) delete process.env.GSTACK_PI_AUTO_GATE_VALIDATED;
      else process.env.GSTACK_PI_AUTO_GATE_VALIDATED = original;
    }
  });
});
