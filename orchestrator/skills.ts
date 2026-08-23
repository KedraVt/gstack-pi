/**
 * Skill ingestion for the workflow orchestrator.
 *
 * The orchestrator (not the model) decides when skill knowledge is needed:
 *  - main-execution phases get the FULL distilled digest injected;
 *  - subagent phases get the full digest inside the specialist's task string,
 *    while orchestrator instructions carry only the compact DoD gate
 *    (definition of done + best practices) needed to verify their output;
 *  - repeat deliveries within one workflow run degrade to the DoD gate too.
 *
 * Digests live in <extensionRoot>/skills-distilled/<skillId>.md. Vendored
 * protocols (e.g. grilling) have no upstream SKILL.md — their distilled file
 * IS the source.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = join(here, "..");
export const DISTILLED_DIR = join(EXTENSION_ROOT, "skills-distilled");
export const SKILLS_DIR = join(EXTENSION_ROOT, "skills");

export interface SkillInfo {
  id: string;
  /** One-line description of what the skill contributes to a phase. */
  summary: string;
  /** Definition of Done + best practices — the compact verification gate. */
  dod: string;
  /** Absolute path of the distilled digest (skills-distilled/<id>.md). */
  distilledPath: string;
  /** Absolute path of the full upstream SKILL.md, or null for vendored skills. */
  fullPath: string | null;
}

interface RegistryEntry {
  summary: string;
  dod: string;
  /** Directory name under skills/, omitted for vendored protocols. */
  upstreamDir?: string;
}

const REGISTRY: Record<string, RegistryEntry> = {
  "gstack-investigate": {
    summary: "Systematic debugging: Iron Law (no fixes without root cause), hypothesis testing, structured debug report",
    dod: "DoD: DEBUG REPORT block (Symptom / Root cause / Fix with file:line / Evidence / Regression test / Status DONE|DONE_WITH_CONCERNS|BLOCKED). BP: no fix without reproduced root cause; stop after 3 failed hypotheses; never claim a fix works without re-running the reproduction.",
  },
  "gstack-review": {
    summary: "Pre-landing review: scope drift detection, severity-classified findings, completeness gaps",
    dod: "DoD: Scope Check line (CLEAN/DRIFT DETECTED/REQUIREMENTS MISSING) + findings categorized CRITICAL/HIGH/MEDIUM/LOW with file:line + concrete failure scenario + final verdict APPROVE|APPROVE_WITH_FIXES|REQUEST_CHANGES. BP: never approve with open CRITICALs; no finding without a scenario.",
  },
  "gstack-qa": {
    summary: "Browser QA: test like a real user, severity-classified bug reports, evidence screenshots",
    dod: "DoD: QA REPORT block (URL, flows covered, bug counts by severity, fixed/not-fixed lists, regression tests, evidence paths, verdict PASS|PASS_WITH_ISSUES|FAIL). BP: no bug without repro steps + screenshot evidence; re-verify every fix in the browser; report-only mode never commits.",
  },
  "gstack-ship": {
    summary: "Release pipeline: pre-flight checks, test gates, TODOS.md management, atomic commits, PR discipline",
    dod: "DoD: SHIP REPORT block (branch, commit count, test counts, coverage gaps→fixed/flagged, TODOS.md updated, PR url, CI status, SHIPPED|BLOCKED_reason). BP: atomic bisectable commits, never git add -A, never commit broken tests, TODOS.md reconciled, no force-push to shared branches.",
  },
  "gstack-office-hours": {
    summary: "Product judgment for planning: premise-challenge, specificity, wedge thinking, scope ambition",
    dod: "DoD: problem stated in user terms before solutions; every assumption surfaced and either confirmed or corrected by the user; converged scope is narrow enough to ship. BP: take positions, push vague answers, interest ≠ demand, status quo is the competitor.",
  },
  "gstack-plan-eng-review": {
    summary: "Engineering rigor for plans: blast radius, hidden assumptions, edge cases, test strategy",
    dod: "DoD: plan file contains Goal / NOT-in-scope / Architecture / Files-to-change / Edge-cases & risks / Test strategy / Open questions (near-zero). BP: boring technology by default, explicit over clever, complexity gate at 8+ files, right-sized diff.",
  },
  "gstack-document-release": {
    summary: "Post-ship docs: Diataxis coverage map, factual updates from the diff, stale-reference sweep",
    dod: "DoD: DOC REPORT block (files reviewed, updated, generated, remaining gaps, DONE|DONE_WITH_GAPS) + docs committed atomically. BP: never regenerate CHANGELOG content — targeted edits only; stop only for risky narrative changes.",
  },
  "gstack-document-generate": {
    summary: "Author missing documentation: codebase archaeology first, Diataxis partitioning, reference-first writing",
    dod: "DoD: concept map produced before writing; reference docs written before tutorials/how-tos; every sample runnable or verbatim from repo. BP: research the whole feature surface first; document only behavior that exists.",
  },
  "grilling": {
    summary: "Interview protocol: design-tree rounds over the frontier, recommended answers, facts-vs-decisions split",
    dod: "DoD: rounds end only when the frontier is empty (nothing silently assumed); every question carried a recommended answer; facts looked up, decisions asked. BP: batch the frontier per round; wait for answers before recomputing.",
    // vendored protocol — no upstream SKILL.md
  },
  "gstack-fix-strategy": {
    summary: "Minimal-fix strategy for a CONFIRMED root cause: validation-first, minimal diff, regression test per fix",
    dod: "DoD: `VALIDATED: <mechanism @ file:line>` first line, then exact files to change + regression risks; `REFUTED: <reason>` first line if the cause does not hold. BP: no fix without a validated mechanism confirmed against code; minimal diff only; every fix ships a regression test that fails before and passes after.",
    // vendored digest derived from the investigate methodology's Phase 4 — no upstream SKILL.md
  },
};

export function getSkillIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getSkillInfo(id: string): SkillInfo | null {
  const entry = REGISTRY[id];
  if (!entry) return null;
  const upstreamDir = entry.upstreamDir ?? (id.startsWith("gstack-") ? id : undefined);
  const fullPath = upstreamDir ? join(SKILLS_DIR, upstreamDir, "SKILL.md") : null;
  return {
    id,
    summary: entry.summary,
    dod: entry.dod,
    distilledPath: join(DISTILLED_DIR, `${id}.md`),
    fullPath: fullPath && existsSync(fullPath) ? fullPath : null,
  };
}

/**
 * Load the distilled methodology digest for a skill.
 * Returns null on any failure so callers can degrade gracefully to the
 * generic phase instructions (a missing digest must never break a run).
 */
export function loadSkillDigest(id: string): string | null {
  const info = getSkillInfo(id);
  if (!info) return null;
  try {
    if (!existsSync(info.distilledPath)) return null;
    const content = readFileSync(info.distilledPath, "utf-8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** Compact index of all bundled skills, for optional deep consultation by the agent. */
export function buildSkillIndex(): string {
  const lines: string[] = ["Available gstack skills (read the full SKILL.md only if you need depth beyond your current instructions):"];
  for (const id of getSkillIds()) {
    const info = getSkillInfo(id)!;
    lines.push(`- ${id}: ${info.summary} (full doc: ${info.fullPath})`);
  }
  return lines.join("\n");
}
