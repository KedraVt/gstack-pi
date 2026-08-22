export interface WorkflowPhase {
  id: string;
  name: string;
  execution: "main" | "subagent";
  agent?: string;
  chain?: Array<{ agent: string; task: string }>;
  optional: boolean;
  skipWhen?: (ctx: WorkflowContext) => boolean;
  /** Distilled skill digests injected by the orchestrator (ids from the skills registry). */
  skills?: string[];
  /** Phase behavior variant, e.g. "report-only" for QA phases. */
  variant?: string;
  /**
   * Advancement policy. "auto" (default): the workflow proceeds as soon as the
   * phase completes via gstack_advance. "manual": after completion the
   * workflow enters awaiting_approval and only `/gstack next` moves it on.
   */
  advance?: "auto" | "manual";
}

export interface IntentPattern {
  pattern: RegExp;
  weight: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  intents: IntentPattern[];
  phases: WorkflowPhase[];
}

export interface PhaseResult {
  status: "completed" | "skipped" | "failed";
  summary: string;
}

export interface WorkflowState {
  workflowId: string;
  phaseIndex: number;
  status: "active" | "paused" | "completed" | "aborted" | "awaiting_approval";
  goal: string;
  results: Record<string, PhaseResult>;
  /** Skill digests already delivered in full during this run — repeats get the DoD gate only. */
  skillsDelivered?: string[];
}

export interface GitContext {
  branch: string;
  hasUncommittedChanges: boolean;
  hasStagedChanges: boolean;
  aheadOfRemote: number;
  behindRemote: number;
  isMainBranch: boolean;
  recentCommitSubject: string;
}

export interface WorkflowContext {
  state: WorkflowState;
  git: GitContext;
  cwd: string;
}
