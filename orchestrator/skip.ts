/**
 * Structural skip: root-cause marker parsing with anti-spoofing guards
 * (efficiency plan STEP 4 / COR-01, COR-02).
 *
 * SECURITY: everything in a subagent summary is UNTRUSTED INPUT — repo content
 * can plant the literal marker string anywhere. A collapse therefore triggers
 * ONLY if ALL guards hold:
 *  1. the marker appears inside the structured `## HANDOFF` section of the
 *     handoff text extracted by extractHandoff();
 *  2. EVERY cited file exists on disk relative to cwd;
 *  3. the validate-only step itself is NEVER skipped nor compressed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface RootCauseMarker {
  cause: string;
  files: string[];
}

const MARKER_RE = /^CONFIRMED ROOT CAUSE:\s*(.+?)\s*\|\s*files:\s*(.+)$/im;

/**
 * Parse the `CONFIRMED ROOT CAUSE: <cause> | files: <f1, f2>` marker from an
 * extractHandoff payload. Returns null when absent, malformed, or when any
 * anti-spoofing guard fails ("none" counts as absent).
 */
export function parseRootCauseMarker(
  handoffText: string,
  cwd: string,
  warn?: (message: string) => void,
): RootCauseMarker | null {
  const match = MARKER_RE.exec(handoffText ?? "");
  if (!match) return null;

  // Guard 1: only inside the ## HANDOFF section.
  const handoffStart = handoffText.indexOf("## HANDOFF");
  if (handoffStart < 0 || match.index! < handoffStart) {
    warn?.("[skip] root-cause marker outside HANDOFF ignored");
    return null;
  }

  const cause = match[1].trim();
  const files = match[2]
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (!cause || cause.toLowerCase() === "none" || files.length === 0 || files.some((f) => f.toLowerCase() === "none")) {
    return null;
  }

  // Guard 2: every cited file must exist on disk relative to cwd.
  for (const file of files) {
    try {
      if (!fs.existsSync(path.resolve(cwd, file))) return null;
    } catch {
      return null;
    }
  }

  return { cause, files };
}

/**
 * The validate-only task for a collapsed root-cause chain. This step is the
 * anti-spoofing barrier: it is NEVER skippable nor compressible, and the
 * workflow never collapses directly to fix.
 */
export function validateStrategyTask(marker: RootCauseMarker): string {
  const files = marker.files.join(", ");
  return `## DELIVERABLE
Validated fix strategy.
The prior specialist CONFIRMED this cause: "${marker.cause}" (files: ${files}).
1. Quickly verify it against the code (≤5 targeted reads of the cited files).
2. If confirmed: produce "VALIDATED: <mechanism @ file:line>" + full fix strategy.
3. If refuted: produce "REFUTED: <reason>" as the FIRST line of your output.

## STOP CONDITION
Stop when: cause validated or refuted.`;
}

/** True when a text's first meaningful line starts with VALIDATED:. */
export function isValidatedStrategy(text: string): boolean {
  return leadingKeyword(text, "VALIDATED:");
}

/** True when the text's first meaningful line starts with REFUTED:. */
export function isRefutedStrategy(text: string): boolean {
  return leadingKeyword(text, "REFUTED:");
}

function leadingKeyword(text: string, keyword: string): boolean {
  const first = (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
  return first.startsWith(keyword);
}

/**
 * Falsifiable "all tests passed" detection for the QA fix-loop skip
 * (STEP 4d). Malformed or ambiguous summaries → false (never skip on doubt).
 */
export function allTestsPassed(summary: string | undefined | null): boolean {
  if (!summary) return false;
  const s = summary.toLowerCase();
  return (
    /\b0 failures?\b/.test(s) ||
    /\bno failures\b/.test(s) ||
    /\ball (tests |checks )?(pass|passed|green)\b/.test(s)
  );
}
