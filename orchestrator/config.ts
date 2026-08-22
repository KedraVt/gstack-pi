/**
 * Feature flags for the skill-ingestion / deterministic-execution upgrade.
 * All default ON; each can be disabled independently to fall back to the
 * pre-upgrade behavior (advisory subagent hints, generic phase instructions,
 * model-discretionary advancement).
 */

function parse(v: string | undefined): boolean | undefined {
  if (v === undefined || v === "") return undefined;
  return v === "1" || v.toLowerCase() === "on" || v.toLowerCase() === "true";
}

/** Inject distilled skill methodology into phase instructions / subagent tasks. */
export function skillsEnabled(): boolean {
  return parse(process.env.GSTACK_PI_SKILLS) ?? true;
}

/** Spawn subagents directly from the executor instead of asking the model to. */
export function deterministicSubagents(): boolean {
  return parse(process.env.GSTACK_PI_DETERMINISTIC) ?? true;
}

/** Pause for user approval after decision phases (plan, root-cause). */
export function manualGates(): boolean {
  return parse(process.env.GSTACK_PI_MANUAL_GATES) ?? true;
}
