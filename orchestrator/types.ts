export interface WorkflowPhase {
  id: string;
  name: string;
  execution: "main" | "subagent";
  agent?: string;
  chain?: Array<{ agent: string; task: string }>;
  optional: boolean;
  skipWhen?: (ctx: WorkflowContext) => boolean;
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
  status: "active" | "paused" | "completed" | "aborted";
  goal: string;
  results: Record<string, PhaseResult>;
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
