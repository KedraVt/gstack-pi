// Sprint workflow tests (feat/sprint-workflow): verdict parsing, dual-channel
// verification, deterministic routing, loop engine, D4 parks, sprint numbering,
// conditional digests + glossary injection, model tiers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createState, advancePhase, routeVerdict, parkForUnreadableVerdict, forceApproveParked, returnParkedWithContext, isSecurityFrozen, unfreeze, forceContinuePastGate } from "../orchestrator/state.ts";
import { getAllWorkflows, getWorkflow } from "../orchestrator/workflows.ts";
import { parseHandoffVerdicts, verifyArtifactVerdicts, extractBlockers, buildRetryFeedback, mergeParseOutcomes, KNOWN_VARIABLES } from "../orchestrator/verdicts.ts";
import { computeNextSprintNumber, pad2, sprintArchiveDir, archivedSprintDirs } from "../orchestrator/sprint.ts";
import { buildPhaseInstructions, buildDeterministicPlan, retryContextBlock, conditionalSkillIds, glossaryTable, MASTER_DOD } from "../orchestrator/templates.ts";
import { modelTierFor, sprintMaxAttempts, sprintArchMaxAttempts, timeoutClassFor } from "../orchestrator/config.ts";

const SPRINT = getWorkflow("sprint")!;

function makeCtx(phaseIndex = 0): any {
  return {
    state: { workflowId: "sprint", phaseIndex, status: "active", goal: "sprint goal", results: {}, version: 2, attempts: {} },
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

function sprintState(phaseIndex: number, extra: Record<string, unknown> = {}): any {
  return { ...createState("sprint", "sprint goal"), phaseIndex, ...extra };
}

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- Registration ------------------------------------------------------------

describe("sprint workflow registration", () => {
  test("phase order matches the approved graph (D6)", () => {
    assert.deepEqual(
      SPRINT.phases.map((p) => p.id),
      ["understand", "user-story", "capability", "system-design", "architect-gate", "backlog", "implement", "devsecops-review", "qa-verdict", "commit-archive"],
    );
  });

  test("verdict-bearing phases declare loop targets and ceilings", () => {
    const gate = SPRINT.phases.find((p) => p.id === "architect-gate")!;
    assert.equal(gate.loopBackTo, "system-design");
    assert.equal(typeof gate.maxAttempts, "number");
    const review = SPRINT.phases.find((p) => p.id === "devsecops-review")!;
    assert.equal(review.loopBackTo, "implement");
    const qa = SPRINT.phases.find((p) => p.id === "qa-verdict")!;
    assert.equal(qa.loopBackTo, "implement");
  });

  test("implement is a strict BE→FE chain (D5)", () => {
    const impl = SPRINT.phases.find((p) => p.id === "implement")!;
    assert.deepEqual(impl.chain!.map((s) => s.agent), ["backend-developer", "frontend-developer"]);
  });

  test("commit-archive is a hard manual gate (residual-risk control)", () => {
    assert.equal(SPRINT.phases.find((p) => p.id === "commit-archive")!.advance, "manual");
  });

  test("sprint intents match", () => {
    assert.ok(SPRINT.intents.some((i) => i.pattern.test("run a sprint for this feature")));
    assert.ok(SPRINT.intents.some((i) => i.pattern.test("write the user story")));
  });
});

// --- Verdict parsing (D1/D4 fail-closed) --------------------------------------

describe("verdict parsing (D1/D4 fail-closed)", () => {
  const GREEN_QA = [
    "## REPORT",
    "Executed acceptance criteria against branch feature/x.",
    "",
    "## HANDOFF",
    "VERIFIED FACTS:",
    "- suite green @ qa-artifact_01.md",
    "status == green",
    "DECISIONS: none",
    "OPEN QUESTIONS: none",
    "DO NOT REDO: implementation",
  ].join("\n");

  test("parses whitelisted values inside a HANDOFF", () => {
    const out = parseHandoffVerdicts(GREEN_QA);
    assert.ok(out.parsed);
    assert.equal(out.parsed.verdicts["status"], "green");
    assert.deepEqual(out.lines, ["status == green"]);
  });

  test("case-normalizes values and variable names", () => {
    const out = parseHandoffVerdicts(GREEN_QA.replace("status == green", "STATUS == GREEN"));
    assert.ok(out.parsed);
    assert.equal(out.parsed.verdicts["status"], "green");
  });

  test("verdict line OUTSIDE ## HANDOFF is rejected even in short reports (guard 1)", () => {
    // Short output (<6KB): extractHandoff returns the whole text — containment
    // must still hold. This is the planted-line attack surface.
    assert.equal(parseHandoffVerdicts("All good!\nstatus == green\n(no handoff section)").parsed, null);
  });

  test("missing HANDOFF marker or empty output ⇒ null", () => {
    assert.equal(parseHandoffVerdicts("plain report with status == red").parsed, null);
    assert.equal(parseHandoffVerdicts("").parsed, null);
    assert.equal(parseHandoffVerdicts(undefined as any).parsed, null);
  });

  test("out-of-whitelist value on a known variable fails the WHOLE parse", () => {
    const out = parseHandoffVerdicts(GREEN_QA.replace("status == green", "status == mostly-green"));
    assert.equal(out.parsed, null);
    assert.ok(out.lines.length > 0, "failing lines kept for the D4 panel");
  });

  test("trailing prose after the value fails closed (ambiguity ⇒ null)", () => {
    assert.equal(parseHandoffVerdicts(GREEN_QA.replace("status == green", "status == green — all pass")).parsed, null);
  });

  test("hedged severity fails closed; clean severity parses (D3)", () => {
    const base = "## HANDOFF\nsecurity-review == rejected\nseverity == critical";
    assert.ok(parseHandoffVerdicts(base).parsed?.severity === "critical");
    assert.ok(parseHandoffVerdicts(base.replace("critical", "low")).parsed?.severity === "low");
    assert.equal(parseHandoffVerdicts(base.replace("critical", "critical?")).parsed, null);
    assert.equal(parseHandoffVerdicts(base.replace("critical", "medium-high")).parsed, null);
    // MISSING severity on a security rejection ⇒ whole parse null ⇒ D4 panel.
    // Never auto-route: it could be a critical hole looping silently.
    assert.equal(parseHandoffVerdicts(base.replace("severity == critical", "")).parsed, null, "missing severity fails closed — human decides via D4 panel");
  });

  test("contradictory duplicate verdict lines ⇒ null, last-wins is never trusted (BUG-4)", () => {
    const base = "## HANDOFF\ncode-review == approved";
    assert.ok(parseHandoffVerdicts(`${base}\ncode-review == approved`).parsed, "identical repeat is redundant, not conflicting");
    assert.equal(parseHandoffVerdicts(`${base}\ncode-review == rejected`).parsed, null);
    assert.equal(parseHandoffVerdicts("## HANDOFF\nseverity == high\nseverity == low").parsed, null);
  });

  test("unknown x == y lines are ignored as prose", () => {
    const out = parseHandoffVerdicts("## HANDOFF\ncode-review == approved\ncoverage == high");
    assert.ok(out.parsed);
    assert.deepEqual(Object.keys(out.parsed.verdicts), ["code-review"]);
  });

  test("chain steps parse INDEPENDENTLY then merge (review W1)", () => {
    // Realistic sizes: each step >6KB, so joined-output parsing would keep only
    // the LAST HANDOFF and lose earlier chain steps' verdicts.
    const big = "x".repeat(7 * 1024);
    const stepA = `${big}\n## HANDOFF\nVERIFIED FACTS:\naudited diff\ncode-review == approved`;
    const stepB = `${big}\n## HANDOFF\nVERIFIED FACTS:\nno findings\nsecurity-review == approved\nseverity == low`;
    const merged = mergeParseOutcomes([parseHandoffVerdicts(stepA), parseHandoffVerdicts(stepB)]);
    assert.ok(merged.parsed, "both chain steps' verdicts survive the merge");
    assert.equal(merged.parsed?.verdicts["code-review"], "approved");
    assert.equal(merged.parsed?.verdicts["security-review"], "approved");

    const conflict = mergeParseOutcomes([
      parseHandoffVerdicts("## HANDOFF\ncode-review == approved"),
      parseHandoffVerdicts("## HANDOFF\ncode-review == rejected"),
    ]);
    assert.equal(conflict.parsed, null, "cross-step contradiction fails closed");

    const partial = mergeParseOutcomes([
      parseHandoffVerdicts("## HANDOFF\ncode-review == approved"),
      parseHandoffVerdicts("## HANDOFF\nno verdict lines here"),
    ]);
    assert.equal(partial.parsed, null, "a step without a trustworthy verdict nulls the whole gate");
  });

  test("HANDOFF with no known variables ⇒ null", () => {
    assert.equal(parseHandoffVerdicts("## HANDOFF\ncoverage == high").parsed, null);
  });

  test("KNOWN_VARIABLES covers every routing variable the templates instruct agents to emit", () => {
    for (const v of ["status", "code-review", "security-review", "severity", "docker-build", "docker-security", "software-architect-review"]) {
      assert.ok(KNOWN_VARIABLES.includes(v as any), `missing known variable ${v}`);
    }
  });
});

// --- Dual-channel artifact verification (guard 3) ------------------------------

describe("dual-channel artifact verification (guard 3)", () => {
  function setup(files: Record<string, string>): string {
    const tmp = tmpDir("gstack-verdict-");
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      writeFileSync(path.join(tmp, file), content);
    }
    return tmp;
  }

  test("artifact exists + contains the same line ⇒ confirmed", () => {
    const cwd = setup({ "qa-artifact_01.md": "# QA report\n...\nstatus == green\n" });
    try {
      assert.equal(verifyArtifactVerdicts({ verdicts: { status: "green" } }, cwd, 1), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("artifact missing / disagreeing value ⇒ fail-closed", () => {
    const cwd = setup({});
    try {
      assert.equal(verifyArtifactVerdicts({ verdicts: { status: "green" } }, cwd, 1), false);
      writeFileSync(path.join(cwd, "qa-artifact_01.md"), "status == red\n");
      assert.equal(verifyArtifactVerdicts({ verdicts: { status: "green" } }, cwd, 1), false, "disk says red, handoff said green");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("devsecops artifacts resolve under devsecops/, sprint-stamped (BUG-2)", () => {
    const cwd = setup({ "devsecops/security-review-artifact_01.md": "severity == high\nsecurity-review == rejected\n" });
    try {
      assert.equal(verifyArtifactVerdicts({ verdicts: { "security-review": "rejected" } }, cwd, 1), true, "stamped artifact confirms");
      // BUG-2 regression: an UNSTAMPED leftover from a prior sprint must NOT satisfy this sprint's disk channel
      const stale = setup({ "devsecops/security-review-artifact.md": "severity == high\nsecurity-review == rejected\n" });
      try {
        assert.equal(verifyArtifactVerdicts({ verdicts: { "security-review": "rejected" } }, stale, 1), false, "unstamped stale artifact fails");
      } finally {
        rmSync(stale, { recursive: true, force: true });
      }
      assert.equal(verifyArtifactVerdicts({ verdicts: { "code-review": "approved" } }, cwd, 1), false, "missing artifact fails");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("software-architect-review resolves to the NEWEST sprint-stamped artifact (W5)", () => {
    const cwd = setup({
      "software-architect-artifact_03_1.md": "old\nsoftware-architect-review == rejected\n",
      "software-architect-artifact_03_2.md": "newer\nsoftware-architect-review == approved\n",
      "software-architect-artifact_03_10.md": "newest\nsoftware-architect-review == rejected\n",
      "software-architect-artifact_02_9.md": "other sprint\nsoftware-architect-review == approved\n",
    });
    try {
      // numeric tail sort: _03_10 is newer than _03_2; other sprints ignored
      assert.equal(verifyArtifactVerdicts({ verdicts: { "software-architect-review": "rejected" } }, cwd, 3), true);
      assert.equal(verifyArtifactVerdicts({ verdicts: { "software-architect-review": "approved" } }, cwd, 3), false,
        "newest is _03_10 (rejected) — not _03_2, not another sprint's _02_9");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("only the artifact TAIL window matters (64KB)", () => {
    const cwd = setup({});
    try {
      const padding = "x".repeat(70 * 1024);
      writeFileSync(path.join(cwd, "qa-artifact_02.md"), `status == green\n${padding}`);
      assert.equal(verifyArtifactVerdicts({ verdicts: { status: "green" } }, cwd, 2), false, "line outside the tail window does not count");
      writeFileSync(path.join(cwd, "qa-artifact_03.md"), `${padding}\nstatus == orange`);
      assert.equal(verifyArtifactVerdicts({ verdicts: { status: "orange" } }, cwd, 3), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("template prose cannot confirm a verdict — line-anchored needle (BUG-3)", () => {
    const cwd = setup({
      // Unresolved instruction text left in the artifact by a lazy reviewer:
      "devsecops/code-review-artifact_04.md": "Write devsecops/code-review-artifact.md containing the line 'code-review == approved|rejected'.",
    });
    try {
      assert.equal(verifyArtifactVerdicts({ verdicts: { "code-review": "approved" } }, cwd, 4), false, "'approved|rejected' template line is not an approval");
      // A real verdict line on its own line DOES confirm:
      writeFileSync(path.join(cwd, "devsecops/code-review-artifact_04.md"), "findings: none\ncode-review == approved\n");
      assert.equal(verifyArtifactVerdicts({ verdicts: { "code-review": "approved" } }, cwd, 4), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// --- Feedback extraction -------------------------------------------------------

describe("feedback extraction (loop fuel)", () => {
  test("review rejects yield finding lines only", () => {
    const artifact = [
      "# Code Review",
      "Intro prose without keywords.",
      "- CRITICAL SQL injection @ src/db.ts:12",
      "* Missing rate limiting risk on /api/login",
      "Plain sentence mentioning nothing relevant.",
    ].join("\n");
    const fb = extractBlockers(artifact, "review");
    assert.ok(fb.includes("SQL injection"));
    assert.ok(fb.includes("rate limiting"));
    assert.ok(!fb.includes("Intro prose"));
    assert.ok(!fb.toLowerCase().includes("plain sentence"));
  });

  test("ORANGE extracts the Testability Blockers section", () => {
    const artifact = [
      "# QA Report",
      "## STATUS == ORANGE",
      "### Testability Blockers",
      "- [data-testid=checkout] missing",
      "- #login-form has no stable id",
      "",
      "## Other Section",
      "unrelated",
    ].join("\n");
    const fb = extractBlockers(artifact, "qa-orange");
    assert.ok(fb.includes("data-testid=checkout"));
    assert.ok(!fb.includes("unrelated"));
  });

  test("RED extracts failure reports + rationale; feedback is capped", () => {
    const artifact = [
      "# QA Report",
      "## STATUS == RED",
      "### Failure 1: login broken",
      "Repro: open /login, submit bad creds — 500 returned.",
      "### Final Status Rationale",
      "Two failures block release.",
    ].join("\n");
    const fb = extractBlockers(artifact, "qa-red");
    assert.ok(fb.includes("Repro:"));
    assert.ok(fb.includes("block release"));

    const huge = `- CRITICAL ${"x".repeat(5000)}\n`.repeat(3);
    assert.ok(extractBlockers(huge, "review").length <= 2100, "capped at ~2000 chars");
  });

  test("empty content yields empty feedback", () => {
    assert.equal(extractBlockers("", "review"), "");
    assert.equal(extractBlockers("# nothing structured", "qa-orange"), "");
  });

  test("buildRetryFeedback degrades gracefully when artifacts are unreadable", () => {
    const empty = tmpDir("gstack-fb-");
    try {
      assert.equal(buildRetryFeedback({ verdicts: { status: "red" } }, "qa-verdict", empty, 9), "");
      const parsed = parseHandoffVerdicts("## HANDOFF\nsecurity-review == rejected\nseverity == medium");
      assert.ok(parsed.parsed);
      const fb = buildRetryFeedback(parsed.parsed!, "devsecops-review", empty, undefined);
      assert.equal(fb, ""); // no artifacts on disk → empty payload, never throws
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("buildRetryFeedback reads QA blockers from the sprint-numbered artifact", () => {
    const cwd = tmpDir("gstack-fb2-");
    try {
      writeFileSync(
        path.join(cwd, "qa-artifact_04.md"),
        "## STATUS == RED\n### Failure: cart totals wrong\nRepro: add two items, total off by one.\n",
      );
      const fb = buildRetryFeedback({ verdicts: { status: "red" } }, "qa-verdict", cwd, 4);
      assert.ok(fb.includes("total off by one"), `got: ${fb.slice(0, 120)}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// --- Deterministic routing table -----------------------------------------------

describe("deterministic routing table (routeVerdict)", () => {
  test("approved/green advance linearly (D1)", () => {
    assert.deepEqual(routeVerdict("architect-gate", { verdicts: { "software-architect-review": "approved" } }), { kind: "advance" });
    assert.deepEqual(routeVerdict("qa-verdict", { verdicts: { status: "green" } }), { kind: "advance" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "code-review": "approved", "security-review": "approved" } }), { kind: "advance" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "docker-security": "approved" } }), { kind: "park" }, "BUG-1: gate missing its main verdicts parks, never default-advances");
  });

  test("whitelisted-but-off-map values park instead of advancing (BUG-1)", () => {
    // `status == failed` at the QA gate used to default-advance (fail-open);
    // now it routes as the unambiguous negative it is.
    assert.deepEqual(routeVerdict("qa-verdict", { verdicts: { status: "failed" } }), { kind: "loop-back" });
    // `software-architect-review == success` is neither expected-positive nor a
    // routing negative ⇒ ambiguous intent ⇒ human decides via panel.
    assert.deepEqual(routeVerdict("architect-gate", { verdicts: { "software-architect-review": "success" } }), { kind: "park" });
  });

  test("non-security rejections loop back (D2)", () => {
    assert.deepEqual(routeVerdict("architect-gate", { verdicts: { "software-architect-review": "rejected" } }), { kind: "loop-back" });
    assert.deepEqual(routeVerdict("qa-verdict", { verdicts: { status: "red" } }), { kind: "loop-back" });
    assert.deepEqual(routeVerdict("qa-verdict", { verdicts: { status: "orange" } }), { kind: "loop-back" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "code-review": "rejected", "security-review": "approved" } }), { kind: "loop-back" });
    assert.deepEqual(
      routeVerdict("devsecops-review", { verdicts: { "security-review": "rejected" }, severity: "medium" }),
      { kind: "loop-back" },
      "medium security rejection loops back",
    );
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "security-review": "rejected" }, severity: "low" }), { kind: "loop-back" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "docker-build": "failed" } }), { kind: "loop-back" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "docker-security": "rejected" } }), { kind: "loop-back" });
  });

  test("critical/high security rejection freezes (D3) — never unconditional", () => {
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "security-review": "rejected" }, severity: "critical" }), { kind: "freeze" });
    assert.deepEqual(routeVerdict("devsecops-review", { verdicts: { "security-review": "rejected" }, severity: "high" }), { kind: "freeze" });
  });
});

// --- Loop engine ----------------------------------------------------------------

describe("loop engine in advancePhase (B3)", () => {
  const total = SPRINT.phases.length;

  test("approved architect verdict advances linearly and resets counters", () => {
    const state = sprintState(4, {
      attempts: { "system-design": 2 },
      pendingVerdict: { phaseId: "architect-gate", parsed: { verdicts: { "software-architect-review": "approved" } }, excerpt: "" },
    });
    const next = advancePhase(state, "architect-gate", { status: "completed", summary: "ok" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.phaseIndex, 5);
    assert.equal(next.status, "active");
    assert.equal(next.attempts["system-design"], undefined, "counter reset after approval");
  });

  test("rejected verdict loops back with attempt increment + retry context", () => {
    const state = sprintState(4, {
      pendingVerdict: { phaseId: "architect-gate", parsed: { verdicts: { "software-architect-review": "rejected" } }, excerpt: "" },
    });
    const next = advancePhase(state, "architect-gate", { status: "completed", summary: "found issues" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.phaseIndex, 3, "back to system-design");
    assert.equal(next.attempts["system-design"], 1);
    assert.ok(next.retryContext);
    assert.equal(next.retryContext.targetPhaseId, "system-design");
    assert.equal(next.retryContext.attempt, 2, "upcoming run number");
    assert.equal(next.retryContext.maxAttempts, sprintArchMaxAttempts());
  });

  test("attempt ceiling parks the workflow with an exhaustion reason", () => {
    const ceiling = sprintMaxAttempts();
    const state = sprintState(7, {
      attempts: { implement: ceiling - 1 },
      pendingVerdict: { phaseId: "devsecops-review", parsed: { verdicts: { "code-review": "rejected" } }, excerpt: "" },
    });
    const next = advancePhase(state, "devsecops-review", { status: "completed", summary: "still failing" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.status, "paused");
    assert.match(next.pausedReason!, /^loop-exhausted:implement/);
    assert.equal(next.attempts.implement, ceiling);
  });

  test("security critical/high freeze parks WITHOUT advancing or burning attempts (D3)", () => {
    const state = sprintState(7, {
      sprintNumber: 7,
      attempts: { implement: 1 },
      pendingVerdict: { phaseId: "devsecops-review", parsed: { verdicts: { "security-review": "rejected" }, severity: "critical" }, excerpt: "" },
    });
    const next = advancePhase(state, "devsecops-review", { status: "completed", summary: "severe finding" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.ok(isSecurityFrozen(next));
    assert.equal(next.status, "paused");
    assert.equal(next.phaseIndex, 7, "held at the review phase");
    assert.equal(next.attempts.implement, 1, "no attempt burned");
    assert.match(next.freezeInfo.artifactPath, /security-review-artifact_07\.md$/);
    assert.equal(next.results["devsecops-review"].summary, "severe finding", "gate result still recorded");

    const resumed = unfreeze(next);
    assert.equal(isSecurityFrozen(resumed), false);
    assert.equal(resumed.status, "active");
    assert.equal(resumed.phaseIndex, 7, "resume re-runs the review gate");
  });

  test("medium severity security rejection loops back instead of freezing (D3)", () => {
    const state = sprintState(7, {
      pendingVerdict: { phaseId: "devsecops-review", parsed: { verdicts: { "security-review": "rejected" }, severity: "medium" }, excerpt: "" },
    });
    const next = advancePhase(state, "devsecops-review", { status: "completed", summary: "minor finding" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.phaseIndex, 6, "back to implement");
    assert.equal(isSecurityFrozen(next), false);
  });

  test("failed phase pauses without routing on the verdict", () => {
    const state = sprintState(8, {
      pendingVerdict: { phaseId: "qa-verdict", parsed: { verdicts: { status: "red" } }, excerpt: "" },
    });
    const next = advancePhase(state, "qa-verdict", { status: "failed", summary: "crashed" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.status, "paused");
    assert.equal(next.phaseIndex, 8);
    assert.equal(next.pendingVerdict, undefined, "verdict consumed/cleared on failure");
  });

  test("retryContext clears when its target completes again", () => {
    const state = sprintState(7, {
      retryContext: { targetPhaseId: "implement", attempt: 2, maxAttempts: 4, feedback: "fix X" },
      pendingVerdict: { phaseId: "devsecops-review", parsed: { verdicts: { "code-review": "approved", "security-review": "approved" } }, excerpt: "" },
    });
    const next = advancePhase(state, "devsecops-review", { status: "completed", summary: "clean" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.phaseIndex, 8);
    assert.equal(next.retryContext, undefined);
  });

  test("phases without loopBackTo advance linearly even with a stale pendingVerdict", () => {
    const state = sprintState(0, {
      pendingVerdict: { phaseId: "understand", parsed: { verdicts: { status: "red" } }, excerpt: "" },
    });
    const next = advancePhase(state, "understand", { status: "completed", summary: "ok" }, total, { phases: SPRINT.phases, cwd: process.cwd() });
    assert.equal(next.phaseIndex, 1);
    assert.equal(next.status, "active");
  });
});

// --- D4 park helpers -------------------------------------------------------------

describe("D4 park helpers", () => {
  test("park is idempotent and burns no attempts", () => {
    const state = sprintState(7, { attempts: { implement: 2 } });
    const parked = parkForUnreadableVerdict(state, "devsecops-review");
    assert.equal(parked.status, "paused");
    assert.equal(parked.verdictPark, "devsecops-review");
    assert.equal(parked.pausedReason, "verdict-unreadable:devsecops-review");
    const reparked = parkForUnreadableVerdict(parked, "devsecops-review");
    assert.equal(reparked, parked, "idempotent");
  });

  test("forceApproveParked advances past the gate and records the decision", () => {
    const parked = parkForUnreadableVerdict(sprintState(8), "qa-verdict");
    const next = forceApproveParked(parked);
    assert.equal(next.phaseIndex, 9);
    assert.equal(next.status, "active");
    assert.match(next.results["qa-verdict"].summary, /unreadable/i);
    assert.equal(next.verdictPark, undefined);
    assert.equal(next.pendingVerdict, undefined);
  });

  test("returnParkedWithContext loops back without incrementing attempts", () => {
    const parked = parkForUnreadableVerdict(sprintState(8, { attempts: { implement: 1 } }), "qa-verdict");
    const next = returnParkedWithContext(parked, SPRINT.phases, "custom guidance");
    assert.ok(next);
    assert.equal(next!.phaseIndex, 6, "back to implement");
    assert.equal(next!.attempts.implement, 1, "no burn");
    assert.ok(next!.retryContext.feedback.includes("custom guidance"));
  });

  test("returnParkedWithContext refuses non-looping phases (null)", () => {
    const parked = parkForUnreadableVerdict(sprintState(8), "qa-verdict");
    assert.equal(returnParkedWithContext(parked, getWorkflow("develop")!.phases), null);
  });

  test("forceContinuePastGate skips one gate forward and clears pause markers", () => {
    const state = sprintState(7, { pausedReason: "loop-exhausted:implement after 4 runs", pendingVerdict: { phaseId: "devsecops-review", parsed: null, excerpt: "" } });
    const next = forceContinuePastGate(state);
    assert.equal(next.phaseIndex, 8);
    assert.equal(next.status, "active");
    assert.equal(next.pendingVerdict, undefined);
    assert.equal(next.pausedReason, undefined);
  });
});

// --- State migration ---------------------------------------------------------------

describe("state migration (v2 fields default on old states)", () => {
  test("createState stamps version 2 + fresh attempt counters", () => {
    const s = createState("sprint", "goal");
    assert.equal(s.version, 2);
    assert.deepEqual(s.attempts, {});
  });

  test("advancePhase tolerates states missing attempts entirely (pre-sprint sessions)", () => {
    const old = { ...createState("investigate", "goal"), version: undefined, attempts: undefined };
    const next = advancePhase(old as any, "reproduce", { status: "completed", summary: "ok" }, 5);
    assert.deepEqual(next.attempts, {});
    assert.equal(next.phaseIndex, 1);
  });
});

// --- Sprint numbering (E5) -----------------------------------------------------------

describe("sprint numbering discovery (E5)", () => {
  test("pad2 zero-pads", () => {
    assert.equal(pad2(7), "07");
    assert.equal(pad2(12), "12");
  });

  test("empty project ⇒ next is 01", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      assert.deepEqual(computeNextSprintNumber(tmp), { next: 1, anomaly: null });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("gaps are fine: root 01 + archive 03 ⇒ 04", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      writeFileSync(path.join(tmp, "user-story_01.md"), "x");
      const arch = path.join(tmp, ".gstack", "sprints", "sprint_03");
      fs.mkdirSync(arch, { recursive: true });
      writeFileSync(path.join(arch, "user-story_03.md"), "x");
      assert.deepEqual(computeNextSprintNumber(tmp), { next: 4, anomaly: null });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("archive-only history counts toward the max", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      const arch = path.join(tmp, ".gstack", "sprints", "sprint_05");
      fs.mkdirSync(arch, { recursive: true });
      writeFileSync(path.join(arch, "user-story_05.md"), "x");
      assert.equal(computeNextSprintNumber(tmp).next, 6);
      assert.deepEqual(archivedSprintDirs(tmp).map((d) => path.basename(d)), ["sprint_05"]);
      assert.equal(sprintArchiveDir(tmp, 6), path.join(tmp, ".gstack", "sprints", "sprint_06"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("root/archive collision ⇒ hijack-guard anomaly (never guess)", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      writeFileSync(path.join(tmp, "user-story_02.md"), "live?");
      const arch = path.join(tmp, ".gstack", "sprints", "sprint_02");
      fs.mkdirSync(arch, { recursive: true });
      writeFileSync(path.join(arch, "user-story_02.md"), "archived?");
      const d = computeNextSprintNumber(tmp);
      assert.ok(Number.isNaN(d.next));
      assert.match(d.anomaly!, /both in project root/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test(">1 live sprint in root ⇒ anomaly", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      writeFileSync(path.join(tmp, "user-story_02.md"), "a");
      writeFileSync(path.join(tmp, "user-story_09.md"), "b");
      const d = computeNextSprintNumber(tmp);
      assert.ok(Number.isNaN(d.next));
      assert.match(d.anomaly!, /un-archived sprints/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("non user-story files are ignored by the scan", () => {
    const tmp = tmpDir("gstack-num-");
    try {
      writeFileSync(path.join(tmp, "README.md"), "x");
      writeFileSync(path.join(tmp, "tasks_99.md"), "x");
      writeFileSync(path.join(tmp, "user-story_notanumber.md"), "x");
      assert.deepEqual(computeNextSprintNumber(tmp), { next: 1, anomaly: null });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- Conditional digests (D14) + glossary (E6) -----------------------------------------

describe("conditional digests (D14) + glossary injection (E6)", () => {
  test("docker/pipeline digests dropped when their trigger is absent", () => {
    const tmp = tmpDir("gstack-cond-");
    try {
      assert.deepEqual(conditionalSkillIds(["gstack-review", "gstack-sprint-docker", "gstack-sprint-pipeline"], tmp), ["gstack-review"]);
      writeFileSync(path.join(tmp, "Dockerfile"), "FROM node");
      fs.mkdirSync(path.join(tmp, ".github", "workflows"), { recursive: true });
      writeFileSync(path.join(tmp, ".github", "workflows", "ci.yml"), "on: push");
      assert.deepEqual(
        conditionalSkillIds(["gstack-review", "gstack-sprint-docker", "gstack-sprint-pipeline"], tmp),
        ["gstack-review", "gstack-sprint-docker", "gstack-sprint-pipeline"],
      );
      assert.equal(conditionalSkillIds(undefined, tmp), undefined);
      assert.deepEqual(conditionalSkillIds(["gstack-review"], undefined), ["gstack-review"], "no cwd ⇒ passthrough");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("glossaryTable scrapes the BINDING table from system-design_XX.md", () => {
    const tmp = tmpDir("gstack-glos-");
    try {
      writeFileSync(
        path.join(tmp, `system-design_${pad2(3)}.md`),
        "# Design\n\n## Ubiquitous Language\n\n| Term | Definition | Forbidden synonym |\n|---|---|---|\n| Cart | basket | trolley |\n\n## Next\nother",
      );
      const g = glossaryTable(tmp, 3);
      assert.match(g, /BINDING/);
      assert.match(g, /trolley/);
      assert.ok(!g.includes("other"), "stops at the next ## heading");
      assert.match(glossaryTable(tmp, 99), /not yet available/, "missing file degrades to placeholder");
      assert.match(glossaryTable(process.cwd(), undefined), /not yet available/, "no sprint number yet ⇒ placeholder");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("retryContextBlock leads looped-back instructions with blockers", () => {
    const ctx = makeCtx(6);
    ctx.state.retryContext = { targetPhaseId: "implement", attempt: 3, maxAttempts: 4, feedback: "- CRITICAL bug @ a.ts:1" };
    assert.match(retryContextBlock(ctx, "implement"), /RETRY CONTEXT \(attempt 3\/4\)/);
    assert.ok(retryContextBlock(ctx, "implement").includes("CRITICAL bug"));
    assert.equal(retryContextBlock(ctx, "qa-verdict"), "", "non-target phase gets nothing");
    ctx.state.retryContext = { targetPhaseId: "implement", attempt: 2, maxAttempts: 4, feedback: "" };
    assert.match(retryContextBlock(ctx, "implement"), /re-read the prior review/);
  });
});

// --- Sprint instruction assembly ----------------------------------------------------------

describe("sprint instruction assembly", () => {
  function sprintCtx(phaseIndex: number): any {
    const ctx = makeCtx(phaseIndex);
    ctx.state.sprintNumber = 7;
    return ctx;
  }

  test("{sprint} interpolates zero-padded into contracts", () => {
    const instructions = buildPhaseInstructions(findPhaseSafe("user-story"), sprintCtx(1));
    assert.match(instructions, /user-story_07\.md/);
    const plan = buildDeterministicPlan(findPhaseSafe("architect-gate"), sprintCtx(4));
    assert.match(plan[0].task, /Sprint 07/);
    assert.ok(!plan[0].task.includes("{sprint}"), "token fully replaced");
  });

  test("master DoD lands ONLY on the last step of execution chains (P07–P10)", () => {
    const implPlan = buildDeterministicPlan(findPhaseSafe("implement"), sprintCtx(6));
    assert.equal(implPlan[0].task.includes(MASTER_DOD), false, "BE step stays lean");
    assert.ok(implPlan[implPlan.length - 1].task.includes(MASTER_DOD));

    const revPlan = buildDeterministicPlan(findPhaseSafe("devsecops-review"), sprintCtx(7));
    assert.equal(revPlan[revPlan.length - 1].task.includes(MASTER_DOD), true);

    const qaPlan = buildDeterministicPlan(findPhaseSafe("qa-verdict"), sprintCtx(8));
    assert.equal(qaPlan[0].task.includes(MASTER_DOD), true);

    const storyInstructions = buildPhaseInstructions(findPhaseSafe("user-story"), sprintCtx(1));
    assert.equal(storyInstructions.includes(MASTER_DOD), false, "planning phases carry no DoD");
  });

  test("verdict dual-channel duty is instructed in gate tasks", () => {
    const qaPlan = buildDeterministicPlan(findPhaseSafe("qa-verdict"), sprintCtx(8));
    assert.match(qaPlan[0].task, /status == green\|red\|orange/);
    assert.match(qaPlan[0].task.toLowerCase(), /handoff/);
    const archPlan = buildDeterministicPlan(findPhaseSafe("architect-gate"), sprintCtx(4));
    assert.match(archPlan[0].task, /software-architect-review == approved\|rejected/);
    const revChain = buildDeterministicPlan(findPhaseSafe("devsecops-review"), sprintCtx(7));
    assert.match(revChain[0].task, /code-review == approved\|rejected/);
    assert.match(revChain[1].task, /security-review == approved\|rejected/);
  });

  test("timeout classes cover all sprint phases 1:1", () => {
    for (const p of SPRINT.phases) {
      assert.notEqual(timeoutClassFor(p.id), null, `${p.id} unmapped`);
    }
  });
});

function findPhaseSafe(phaseId: string) {
  const phase = SPRINT.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`phase not found: ${phaseId}`);
  return phase;
}

// --- Model tiers (E4/D10, inert by default) -------------------------------------------------

describe("model tiers (E4/D10, inert by default)", () => {
  const KEYS = ["GSTACK_PI_MODEL_STRONG", "GSTACK_PI_MODEL_FAST"];
  let saved: Record<string, string | undefined>;

  function setup() {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }
  function restore() {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  test("unset envs ⇒ undefined override everywhere (inert)", () => {
    setup();
    try {
      assert.equal(modelTierFor("implement"), undefined);
      assert.equal(modelTierFor("explore"), undefined);
    } finally {
      restore();
    }
  });

  test("STRONG routes judgment phases; FAST everything else; unset side keeps agent default", () => {
    setup();
    try {
      process.env.GSTACK_PI_MODEL_STRONG = "strong/model";
      assert.equal(modelTierFor("implement"), "strong/model");
      assert.equal(modelTierFor("qa-verdict"), "strong/model");
      assert.equal(modelTierFor("explore"), undefined, "FAST unset ⇒ keep agent default");

      process.env.GSTACK_PI_MODEL_FAST = "fast/model";
      assert.equal(modelTierFor("explore"), "fast/model");

      process.env.GSTACK_PI_MODEL_STRONG = "";
      assert.equal(modelTierFor("implement"), undefined, "empty env falls back to agent default");
    } finally {
      restore();
    }
  });
});
