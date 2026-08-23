import type { Workflow } from "./types.ts";

const develop: Workflow = {
  id: "develop",
  name: "Full Development Cycle",
  description: "Understand, plan, implement, QA, review, and ship a feature end-to-end",
  intents: [
    { pattern: /\b(build|implement|develop|create|add)\b.*\b(feature|component|module|page|api|endpoint)\b/i, weight: 0.85 },
    { pattern: /\b(new feature|feature request|let's build|i want to add)\b/i, weight: 0.8 },
    { pattern: /\b(from scratch|greenfield|start a new)\b/i, weight: 0.7 },
  ],
  phases: [
    {
      id: "understand",
      name: "Understand Requirements",
      execution: "main",
      optional: false,
    },
    {
      id: "explore",
      name: "Codebase Exploration",
      execution: "subagent",
      agent: "scout",
      optional: false,
    },
    {
      id: "plan",
      name: "Interactive Planning",
      execution: "main",
      optional: false,
      // Decision phase: interview rounds with the user, then the written
      // plan is reviewed before any code is written.
      advance: "manual",
      skills: ["gstack-office-hours", "grilling", "gstack-plan-eng-review"],
    },
    {
      id: "implement",
      name: "Implementation",
      execution: "subagent",
      agent: "worker",
      optional: false,
    },
    {
      id: "qa",
      name: "QA Testing",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-qa"],
    },
    {
      id: "review",
      name: "Code Review",
      execution: "subagent",
      agent: "reviewer",
      optional: false,
      skills: ["gstack-review"],
    },
    {
      id: "ship",
      name: "Ship (PR + Push)",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-ship"],
    },
    {
      id: "document",
      name: "Documentation Update",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-document-release", "gstack-document-generate"],
    },
  ],
};

const investigate: Workflow = {
  id: "investigate",
  name: "Bug Investigation",
  description: "Systematic debugging: reproduce, find root cause, fix, and verify",
  intents: [
    { pattern: /\b(debug|fix\s+(this|the)\s+bug|why\s+is\s+.+\s+broken|root\s+cause|investigate)\b/i, weight: 0.9 },
    { pattern: /\b(error|500|stack\s*trace|exception|crash|panic)\b/i, weight: 0.7 },
    { pattern: /\b(it\s+was\s+working|stopped\s+working|broke|regression)\b/i, weight: 0.65 },
    { pattern: /\b(something's wrong|not working|doesn't work|wtf)\b/i, weight: 0.6 },
  ],
  phases: [
    {
      id: "reproduce",
      name: "Reproduce the Bug",
      execution: "main",
      optional: false,
      skills: ["gstack-investigate"],
    },
    {
      id: "root-cause",
      name: "Root Cause Analysis",
      execution: "subagent",
      chain: [
        { agent: "scout", skills: ["gstack-investigate"], task: "## DELIVERABLE\nSuspicious code paths, recent changes (git log), and likely culprits related to the bug — each with file references.\n\n## STOP CONDITION\nStop when: all code plausibly involved in the reported symptom has been identified. Further exploration is waste.\n\n## CONTEXT\nBug: {goal} | Branch: {branch}\nReproduction context: {reproduce_summary}\n\nFind all code related to this bug and report suspicious code paths, recent changes (git log), and likely culprits." },
        { agent: "planner", skills: ["gstack-fix-strategy"], task: "## DELIVERABLE\nRoot cause + minimal fix strategy: mechanism with file:line references, files to change, regression risks.\n\n## STOP CONDITION\nStop when: the root-cause mechanism is pinned to specific file:line locations and the fix strategy follows from it.\n\n## CONTEXT\nBug: {goal} | Branch: {branch}\nInvestigation context from the prior specialist:\n{previous}\n\nGiven this investigation context, identify the root cause and propose a minimal fix strategy. Output: root cause, fix approach, files to change, regression risks." },
      ],
      optional: false,
      skills: ["gstack-investigate"],
      // Decision phase: the user approves the diagnosis before any fix is applied.
      advance: "manual",
    },
    {
      id: "fix",
      name: "Implement Fix",
      execution: "subagent",
      agent: "worker",
      optional: false,
      skills: ["gstack-investigate"],
    },
    {
      id: "verify",
      name: "Verify Fix",
      execution: "main",
      optional: false,
      skills: ["gstack-investigate"],
    },
    {
      id: "regression-qa",
      name: "Regression QA",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skipWhen: (ctx) => !ctx.git.hasUncommittedChanges,
      skills: ["gstack-qa"],
    },
  ],
};

const qa: Workflow = {
  id: "qa",
  name: "QA Testing",
  description: "Browser-based QA: test user flows, find bugs, capture evidence",
  intents: [
    { pattern: /\b(test the site|qa|does this work|check the deploy|dogfood)\b/i, weight: 0.85 },
    { pattern: /\b(verify|validate|smoke test|e2e|end.to.end)\b/i, weight: 0.7 },
    { pattern: /\b(find bugs|break it|stress test|user flow)\b/i, weight: 0.65 },
  ],
  phases: [
    {
      id: "setup",
      name: "Setup & Scope",
      execution: "main",
      optional: false,
      skills: ["gstack-qa"],
    },
    {
      id: "test",
      name: "Browser Testing",
      execution: "subagent",
      agent: "worker",
      optional: false,
      skills: ["gstack-qa"],
    },
    {
      id: "report",
      name: "Bug Report",
      execution: "main",
      optional: false,
      skills: ["gstack-qa"],
    },
    {
      id: "fix",
      name: "Fix Issues",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-qa"],
    },
  ],
};

const ship: Workflow = {
  id: "ship",
  name: "Ship / Release",
  description: "Pre-checks, review, test, push, open PR, verify CI",
  intents: [
    { pattern: /\b(ship|deploy|push|create\s+(a\s+)?pr|open\s+(a\s+)?pr|let's land|send it)\b/i, weight: 0.9 },
    { pattern: /\b(release|cut a release|tag|publish)\b/i, weight: 0.8 },
    { pattern: /\b(merge|land this|ready to go)\b/i, weight: 0.7 },
  ],
  phases: [
    {
      id: "pre-checks",
      name: "Pre-flight Checks",
      execution: "main",
      optional: false,
      skills: ["gstack-ship"],
    },
    {
      id: "review",
      name: "Code Review",
      execution: "subagent",
      agent: "reviewer",
      optional: false,
      skills: ["gstack-review"],
    },
    {
      id: "test",
      name: "Run Tests",
      execution: "subagent",
      agent: "worker",
      optional: false,
      skills: ["gstack-ship"],
    },
    {
      id: "push-pr",
      name: "Push & Open PR",
      execution: "subagent",
      agent: "worker",
      optional: false,
      skills: ["gstack-ship"],
    },
    {
      id: "verify",
      name: "Verify CI",
      execution: "main",
      optional: false,
      skills: ["gstack-ship"],
    },
    {
      id: "update-docs",
      name: "Documentation Update",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-document-release", "gstack-document-generate"],
    },
  ],
};

const review: Workflow = {
  id: "review",
  name: "Code Review",
  description: "Structured diff review: findings, suggestions, optional fixes",
  intents: [
    { pattern: /\b(review|check my code|look at (my|the) changes|diff check|pre-landing)\b/i, weight: 0.85 },
    { pattern: /\b(code review|pr review|check the diff)\b/i, weight: 0.8 },
  ],
  phases: [
    {
      id: "diff",
      name: "Diff Analysis",
      execution: "subagent",
      agent: "scout",
      optional: false,
    },
    {
      id: "findings",
      name: "Findings & Suggestions",
      execution: "main",
      optional: false,
      skills: ["gstack-review"],
    },
    {
      id: "fix",
      name: "Apply Fixes",
      execution: "subagent",
      agent: "worker",
      optional: true,
      skills: ["gstack-review"],
    },
  ],
};

const quick: Workflow = {
  id: "quick",
  name: "Quick Action",
  description: "Pick a single action (QA, review, ship, investigate) without the full pipeline",
  intents: [
    { pattern: /\b(quick\s+(qa|review|ship|test|check|debug))\b/i, weight: 0.8 },
  ],
  phases: [
    {
      id: "action",
      name: "Execute Action",
      execution: "main",
      optional: false,
    },
  ],
};

const qaReport: Workflow = {
  id: "qa-report",
  name: "QA Report (No Fixes)",
  description: "Browser QA that tests and reports bugs with severity but never modifies code",
  intents: [
    { pattern: /\b(qa[- ]only|report[- ]only|just report (the )?bugs|don'?t fix,? (just )?test)\b/i, weight: 0.85 },
    { pattern: /\b(test the site and report|find bugs without fixing)\b/i, weight: 0.7 },
  ],
  phases: [
    {
      id: "setup",
      name: "Setup & Scope",
      execution: "main",
      optional: false,
      skills: ["gstack-qa"],
      variant: "report-only",
    },
    {
      id: "test",
      name: "Browser Testing",
      execution: "subagent",
      agent: "worker",
      optional: false,
      skills: ["gstack-qa"],
      variant: "report-only",
    },
    {
      id: "report",
      name: "Bug Report",
      execution: "main",
      optional: false,
      skills: ["gstack-qa"],
      variant: "report-only",
    },
  ],
};

const ALL_WORKFLOWS: Workflow[] = [develop, investigate, qa, qaReport, ship, review, quick];

export function getAllWorkflows(): Workflow[] {
  return ALL_WORKFLOWS;
}

export function getWorkflow(id: string): Workflow | undefined {
  return ALL_WORKFLOWS.find((w) => w.id === id);
}

export function getWorkflowIds(): string[] {
  return ALL_WORKFLOWS.map((w) => w.id);
}
