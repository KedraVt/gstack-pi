import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  test("SUBAGENT phases carry DoD gates only — full digests stay out of orchestrator context", () => {
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
  // reproduce is a MAIN phase — its boundary must appear in buildPhaseInstructions
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
  const ITALIAN_STOPLIST = ["fase", "trova", "leggi", "scrivi", "deve", "sempre", "perché", "delle", "degli", "questo"];

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
        !/[àèéìòù]/i.test(s),
        `accented letter found in: ${s.slice(0, 140).replace(/\s+/g, " ")}...`,
      );
    }
  });
});
