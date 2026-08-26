/**
 * Deterministic verdict parsing for the sprint workflow (plan B4 / D1–D4).
 *
 * SECURITY: everything a subagent emits is UNTRUSTED INPUT — repo content can
 * plant literal verdict strings anywhere in the report. Routing therefore
 * happens ONLY if ALL guards hold (guards mirror skip.ts):
 *  1. the `variable == value` line appears inside the structured `## HANDOFF`
 *     section of the subagent's output;
 *  2. every value is matched against a CLOSED whitelist after case
 *     normalization; hedged or malformed values ("high?", "medium-high",
 *     "approved but...") make the WHOLE parse null — never guessed at;
 *  3. each claimed verdict is confirmed by its on-disk artifact: the artifact
 *     must exist and contain the same `variable == value` line within its
 *     ≤64KB tail (dual channel: HANDOFF + disk must agree);
 *  4. ambiguity ⇒ null ⇒ D4 manual park WITHOUT burning an attempt.
 *
 * The orchestrator NEVER advances on doubt.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ParsedVerdict, VerdictSeverity } from "./types.ts";
import { extractHandoff } from "./handoff.ts";
import { pad2 } from "./sprint.ts";

/** Closed value whitelist (case-normalized to lowercase). Anything else ⇒ null. */
const VALUE_WHITELIST = ["approved", "rejected", "green", "red", "orange", "success", "failed"] as const;

/** Closed severity whitelist. Hedged values ⇒ null. */
const SEVERITY_WHITELIST = ["critical", "high", "medium", "low"] as const;

/**
 * Variables the parser recognizes anywhere in a HANDOFF. Unknown
 * `x == y`-shaped lines are ignored as prose; KNOWN variables carrying an
 * out-of-whitelist value are treated as tampered/hedged ⇒ whole parse fails.
 */
export const KNOWN_VARIABLES = [
  "status", // qa-engineer qa-artifact_XX.md
  "code-review", // devsecops code-review-artifact.md
  "security-review", // devsecops security-review-artifact.md
  "severity", // required on security rejection
  "docker-build", // devsecops docker-build-report.md
  "docker-security", // devsecops docker-build-report.md
  "software-architect-review", // software-architect-artifact_n.md
] as const;

const VAR_LINE_RE = /^\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*==\s*(\S[^\n]*)$/;

export interface VerdictParseOutcome {
  parsed: ParsedVerdict | null;
  /** Raw verdict-shaped lines found in the HANDOFF, for the D4 panel display. */
  lines: string[];
}

/**
 * Parse verdict variable/value pairs from the LAST `## HANDOFF` section of a
 * subagent output. Returns `{parsed: null}` when no valid verdict set can be
 * extracted: missing HANDOFF, no known-variable lines, or any known variable
 * carrying an out-of-whitelist (hedged/malformed) value.
 */
export function parseHandoffVerdicts(output: string): VerdictParseOutcome {
  // Guard 1 (mirrors skip.ts): only text at or after the literal `## HANDOFF`
  // marker is scanned. extractHandoff() returns the WHOLE output for short
  // reports (<6KB), so without this containment check a verdict line planted
  // in a short report's body would parse. Fail closed on missing marker.
  const extracted = extractHandoff(output ?? "").text;
  const markerIdx = extracted.indexOf("## HANDOFF");
  if (markerIdx < 0 || !extracted.includes("==")) {
    return { parsed: null, lines: [] };
  }
  const handoff = extracted.slice(markerIdx);

  const lines: string[] = [];
  const verdicts: Record<string, string> = {};
  let severity: VerdictSeverity | undefined;

  for (const raw of handoff.split("\n")) {
    const match = VAR_LINE_RE.exec(raw);
    if (!match) continue;
    const variable = match[1].trim().toLowerCase().replace(/\s+/g, "-");
    if (!(KNOWN_VARIABLES as readonly string[]).includes(variable)) continue;

    lines.push(raw.trim());
    const value = match[2].trim().toLowerCase();

    if (variable === "severity") {
      if (!(SEVERITY_WHITELIST as readonly string[]).includes(value)) {
        return { parsed: null, lines }; // hedged/malformed severity ⇒ D4 panel (D3)
      }
      severity = value as VerdictSeverity;
      continue;
    }

    if (!(VALUE_WHITELIST as readonly string[]).includes(value)) {
      return { parsed: null, lines }; // fail-closed on any malformed known verdict
    }
    verdicts[variable] = value;
  }

  if (Object.keys(verdicts).length === 0) {
    return { parsed: null, lines };
  }
  // D3 fail-closed: a security rejection WITHOUT a parsable severity must
  // never auto-route — it could be a critical hole looping silently. Missing
  // or hedged severity ⇒ whole parse null ⇒ D4 manual panel.
  if (verdicts["security-review"] === "rejected" && !severity) {
    return { parsed: null, lines };
  }
  return { parsed: { verdicts, severity }, lines };
}

// --- Dual-channel artifact cross-check --------------------------------------

/** Artifact tail window for STATUS-line confirmation (plan E2). */
export const ARTIFACT_TAIL_BYTES = 64 * 1024;

function readTail(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const length = Math.min(stat.size, ARTIFACT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Resolve the on-disk artifacts expected to carry each verdict variable,
 * relative to cwd. QA status rides the sprint-numbered artifact; architect
 * review rides the NEWEST software-architect-artifact_n.md (globbed).
 */
export function artifactForVariable(variable: string, cwd: string, sprintNumber?: number): string[] {
  switch (variable) {
    case "status":
      return sprintNumber !== undefined ? [path.join(cwd, `qa-artifact_${pad2(sprintNumber)}.md`)] : [];
    case "code-review":
      return [path.join(cwd, "devsecops", "code-review-artifact.md")];
    case "security-review":
      return [path.join(cwd, "devsecops", "security-review-artifact.md")];
    case "docker-build":
    case "docker-security":
      return [path.join(cwd, "devsecops", "docker-build-report.md")];
    case "software-architect-review": {
      const dir = path.join(cwd);
      try {
        const files = fs
          .readdirSync(dir)
          .filter((f) => /^software-architect-artifact_\d+\.md$/.test(f))
          .sort();
        return files.length > 0 ? [path.join(dir, files[files.length - 1])] : [];
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}

/**
 * Verify EVERY parsed verdict against its on-disk artifact (guard 3): the
 * artifact must exist AND contain the same `variable == value` line within
 * its ≤64KB tail. Any disagreement/absence ⇒ false (fail-closed).
 */
export function verifyArtifactVerdicts(parsed: ParsedVerdict, cwd: string, sprintNumber?: number): boolean {
  for (const [variable, value] of Object.entries(parsed.verdicts)) {
    const needle = `${variable} == ${value}`;
    const candidates = artifactForVariable(variable, cwd, sprintNumber);
    const confirmed = candidates.some((artifactPath) => {
      const tail = readTail(artifactPath)?.toLowerCase();
      return tail?.includes(needle) ?? false;
    });
    if (!confirmed) return false;
  }
  return true;
}

// --- Feedback extraction (loop engine fuel) ---------------------------------

const FEEDBACK_CAP = 2000;

function section(content: string, headingRe: RegExp): string | null {
  const match = headingRe.exec(content);
  if (!match) return null;
  const rest = content.slice(match.index + match[0].length);
  const end = rest.search(/^##\s/m);
  const body = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return body.length > 0 ? body : null;
}

/**
 * Extract retry feedback from a review/QA artifact:
 *  - RED → failure-report sections (repro steps + evidence),
 *  - ORANGE → Testability Blockers (missing selectors),
 *  - reviews → finding/problem list lines.
 * Capped at FEEDBACK_CAP chars; empty when nothing structured is present.
 */
export function extractBlockers(artifactContent: string, kind: "qa-red" | "qa-orange" | "review"): string {
  if (!artifactContent) return "";
  const parts: string[] = [];

  if (kind === "qa-orange") {
    const blockers = section(artifactContent, /###?\s*.*Testability Blockers.*$/im);
    if (blockers) parts.push(blockers);
  } else if (kind === "qa-red") {
    const failures = section(artifactContent, /###?\s*.*(Failure|Bug).*$/gim);
    if (failures) parts.push(failures);
    const rationale = section(artifactContent, /###?\s*Final Status Rationale\s*$/im);
    if (rationale) parts.push(rationale);
  } else {
    // Review rejects: take bullet/finding lines mentioning problems.
    const findings = artifactContent.split("\n").filter((l) => {
      const t = l.trim();
      if (!/^[-*]\s/.test(t) && !/^#{2,3}\s/.test(t)) return false;
      return /(critical|warning|risk|issue|finding|vulnerab|inconsisten|violat|missing|must fix)/i.test(t);
    });
    if (findings.length > 0) parts.push(findings.join("\n"));
  }

  const joined = parts.join("\n\n");
  return joined.length > FEEDBACK_CAP ? `${joined.slice(0, FEEDBACK_CAP)}…(truncated)` : joined;
}

/**
 * Build the RETRY CONTEXT feedback payload for a loop-back: reads the source
 * phase's artifact(s) from disk and extracts its blockers. Best-effort by
 * design — an unreadable artifact degrades to an empty payload, never throws.
 */
export function buildRetryFeedback(
  parsed: ParsedVerdict,
  sourcePhaseId: string,
  cwd: string,
  sprintNumber?: number,
): string {
  if (sourcePhaseId === "qa-verdict") {
    const value = parsed.verdicts["status"] ?? "";
    const kind = value === "orange" ? "qa-orange" : "qa-red";
    const artifactPath = artifactForVariable("status", cwd, sprintNumber)[0];
    const content = artifactPath ? (readTail(artifactPath) ?? "") : "";
    return extractBlockers(content, kind);
  }
  // Review phases: concatenate whatever review artifacts exist.
  const parts: string[] = [];
  for (const variable of ["code-review", "security-review", "software-architect-review"]) {
    for (const p of artifactForVariable(variable, cwd)) {
      const content = readTail(p);
      if (content) {
        const blockers = extractBlockers(content, "review");
        if (blockers) parts.push(`From ${path.basename(p)}:\n${blockers}`);
      }
    }
  }
  return parts.join("\n\n").slice(0, FEEDBACK_CAP);
}
